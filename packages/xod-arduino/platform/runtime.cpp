
/*=============================================================================
 *
 *
 * Runtime
 *
 *
 =============================================================================*/

//----------------------------------------------------------------------------
// Debug routines
//----------------------------------------------------------------------------
#ifndef DEBUG_SERIAL
#  define DEBUG_SERIAL Serial
#endif

#ifdef XOD_DEBUG
#  define XOD_TRACE(x)      { DEBUG_SERIAL.print(x); DEBUG_SERIAL.flush(); }
#  define XOD_TRACE_LN(x)   { DEBUG_SERIAL.println(x); DEBUG_SERIAL.flush(); }
#  define XOD_TRACE_F(x)    XOD_TRACE(F(x))
#  define XOD_TRACE_FLN(x)  XOD_TRACE_LN(F(x))
#else
#  define XOD_TRACE(x)
#  define XOD_TRACE_LN(x)
#  define XOD_TRACE_F(x)
#  define XOD_TRACE_FLN(x)
#endif

//----------------------------------------------------------------------------
// PGM space utilities
//----------------------------------------------------------------------------
#define pgm_read_nodeid(address) (pgm_read_word(address))

/*
 * Workaround for bugs:
 * https://github.com/arduino/ArduinoCore-sam/pull/43
 * https://github.com/arduino/ArduinoCore-samd/pull/253
 * Remove after the PRs merge
 */
#if !defined(ARDUINO_ARCH_AVR) && defined(pgm_read_ptr)
#  undef pgm_read_ptr
#  define pgm_read_ptr(addr) (*(const void **)(addr))
#endif

namespace xod {
//----------------------------------------------------------------------------
// Type definitions
//----------------------------------------------------------------------------
#define NO_NODE                 ((NodeId)-1)

typedef double Number;
typedef bool Logic;

#if NODE_COUNT < 256
typedef uint8_t NodeId;
#elif NODE_COUNT < 65536
typedef uint16_t NodeId;
#else
typedef uint32_t NodeId;
#endif

/*
 * Context is a handle passed to each node `evaluate` function. Currently, it’s
 * alias for NodeId but likely will be changed in future to support list
 * lifting and other features
 */
typedef NodeId Context;

/*
 * LSB of a dirty flag shows whether a particular node is dirty or not
 * Other bits shows dirtieness of its particular outputs:
 * - 1-st bit for 0-th output
 * - 2-nd bit for 1-st output
 * - etc
 *
 * An outcome limitation is that a native node must not have more than 7 output
 * pins.
 */
typedef uint8_t DirtyFlags;

typedef unsigned long TimeMs;
typedef void (*EvalFuncPtr)(Context ctx);

typedef xod::List<char>::ListPtr XString;

/*
 * Each input stores a reference to its upstream node so that we can get values
 * on input pins. Having a direct pointer to the value is not enough because we
 * want to know dirty’ness as well. So we have to use this structure instead of
 * a pointer.
 */
struct UpstreamPinRef {
    // Upstream node ID
    NodeId nodeId;
    // Index of the upstream node’s output.
    // Use 3 bits as it just enough to store values 0..7
    uint16_t pinIndex : 3;
    // Byte offset in a storage of the upstream node where the actual pin value
    // is stored
    uint16_t storageOffset : 13;
};

/*
 * Input descriptor is a metaprogramming structure used to enforce an
 * input’s type and store its wiring data location as a zero-RAM constant.
 *
 * A specialized descriptor is required by `getValue` function. Every
 * input of every type node gets its own descriptor in generated code that
 * can be accessed as input_FOO. Where FOO is a pin identifier.
 */
template<typename ValueT_, size_t wiringOffset>
struct InputDescriptor {
    typedef ValueT_ ValueT;
    enum {
        WIRING_OFFSET = wiringOffset
    };
};

/*
 * Output descriptor serve the same purpose as InputDescriptor but for
 * ouputs.
 *
 * In addition to wiring data location it keeps storage data location (where
 * actual value is stored) and own zero-based index among outputs of a particular
 * node
 */
template<typename ValueT_, size_t wiringOffset, size_t storageOffset, uint8_t index>
struct OutputDescriptor {
    typedef ValueT_ ValueT;
    enum {
        WIRING_OFFSET = wiringOffset,
        STORAGE_OFFSET = storageOffset,
        INDEX = index
    };
};

//----------------------------------------------------------------------------
// Forward declarations
//----------------------------------------------------------------------------
extern void* const g_storages[NODE_COUNT];
extern const void* const g_wiring[NODE_COUNT];
extern DirtyFlags g_dirtyFlags[NODE_COUNT];

// TODO: replace with a compact list
extern TimeMs g_schedule[NODE_COUNT];

void clearTimeout(NodeId nid);

//----------------------------------------------------------------------------
// Engine (private API)
//----------------------------------------------------------------------------

void* getStoragePtr(NodeId nid, size_t offset) {
    return (uint8_t*)pgm_read_ptr(&g_storages[nid]) + offset;
}

template<typename T>
T getStorageValue(NodeId nid, size_t offset) {
    return *reinterpret_cast<T*>(getStoragePtr(nid, offset));
}

void* getWiringPgmPtr(NodeId nid, size_t offset) {
    return (uint8_t*)pgm_read_ptr(&g_wiring[nid]) + offset;
}

template<typename T>
T getWiringValue(NodeId nid, size_t offset) {
    T result;
    memcpy_P(&result, getWiringPgmPtr(nid, offset), sizeof(T));
    return result;
}

bool isOutputDirty(NodeId nid, uint8_t index) {
    return g_dirtyFlags[nid] & (1 << (index + 1));
}

bool isInputDirtyImpl(NodeId nid, size_t wiringOffset) {
    UpstreamPinRef ref = getWiringValue<UpstreamPinRef>(nid, wiringOffset);
    if (ref.nodeId == NO_NODE)
        return false;

    return isOutputDirty(ref.nodeId, ref.pinIndex);
}

template<typename InputT>
bool isInputDirty(NodeId nid) {
    return isInputDirtyImpl(nid, InputT::WIRING_OFFSET);
}

void markPinDirty(NodeId nid, uint8_t index) {
    g_dirtyFlags[nid] |= 1 << (index + 1);
}

void markNodeDirty(NodeId nid) {
    g_dirtyFlags[nid] |= 0x1;
}

bool isNodeDirty(NodeId nid) {
    return g_dirtyFlags[nid] & 0x1;
}

template<typename T>
T getOutputValueImpl(NodeId nid, size_t storageOffset) {
    return getStorageValue<T>(nid, storageOffset);
}

template<typename T>
T getInputValueImpl(NodeId nid, size_t wiringOffset) {
    UpstreamPinRef ref = getWiringValue<UpstreamPinRef>(nid, wiringOffset);
    if (ref.nodeId == NO_NODE)
        return (T)0;

    return getOutputValueImpl<T>(ref.nodeId, ref.storageOffset);
}

template<typename T>
void emitValueImpl(
        NodeId nid,
        size_t storageOffset,
        size_t wiringOffset,
        uint8_t index,
        T value) {

    // Store new value and make the node itself dirty
    T* storedValue = reinterpret_cast<T*>(getStoragePtr(nid, storageOffset));
    *storedValue = value;
    markPinDirty(nid, index);

    // Notify downstream nodes about changes
    // NB: linked nodes array is in PGM space
    const NodeId* pDownstreamNid = getWiringValue<const NodeId*>(nid, wiringOffset);
    NodeId downstreamNid = pgm_read_nodeid(pDownstreamNid);

    while (downstreamNid != NO_NODE) {
        markNodeDirty(downstreamNid);
        downstreamNid = pgm_read_nodeid(pDownstreamNid++);
    }
}

void evaluateNode(NodeId nid) {
    XOD_TRACE_F("eval #");
    XOD_TRACE_LN(nid);
    EvalFuncPtr eval = getWiringValue<EvalFuncPtr>(nid, 0);
    eval(nid);
}

void runTransaction() {
    XOD_TRACE_F("Transaction started, t=");
    XOD_TRACE_LN(millis());
    for (NodeId nid = 0; nid < NODE_COUNT; ++nid)
        if (isNodeDirty(nid))
            evaluateNode(nid);

    memset(g_dirtyFlags, 0, sizeof(g_dirtyFlags));
    XOD_TRACE_F("Transaction completed, t=");
    XOD_TRACE_LN(millis());
}

void idle() {
    TimeMs now = millis();
    for (NodeId nid = 0; nid < NODE_COUNT; ++nid) {
        TimeMs t = g_schedule[nid];
        if (t && t <= now) {
            markNodeDirty(nid);
            clearTimeout(nid);
            return;
        }
    }
}

//----------------------------------------------------------------------------
// Public API (can be used by native nodes’ `evaluate` functions)
//----------------------------------------------------------------------------

template<typename InputT>
typename InputT::ValueT getValue(NodeId nid) {
    return getInputValueImpl<typename InputT::ValueT>(nid, InputT::WIRING_OFFSET);
}

template<typename OutputT>
void emitValue(NodeId nid, typename OutputT::ValueT value) {
    emitValueImpl(
            nid,
            OutputT::STORAGE_OFFSET,
            OutputT::WIRING_OFFSET,
            OutputT::INDEX,
            value);
}

TimeMs transactionTime() {
    return millis();
}

void setTimeout(NodeId nid, TimeMs timeout) {
    g_schedule[nid] = transactionTime() + timeout;
}

void clearTimeout(NodeId nid) {
    g_schedule[nid] = 0;
}

} // namespace xod

//----------------------------------------------------------------------------
// Entry point
//----------------------------------------------------------------------------
void setup() {
    // FIXME: looks like there is a rounding bug. Waiting for 1 second fights it
    delay(1000);
#ifdef XOD_DEBUG
    DEBUG_SERIAL.begin(9600);
#endif
    XOD_TRACE_FLN("\n\nProgram started");
}

void loop() {
    xod::idle();
    xod::runTransaction();
}
