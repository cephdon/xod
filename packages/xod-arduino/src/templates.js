import R from 'ramda';
import Handlebars from 'handlebars';

import { def } from './types';

import configTpl from '../platform/configuration.tpl.cpp';
import patchContextTpl from '../platform/patchContext.tpl.cpp';
import implListTpl from '../platform/implList.tpl.cpp';
import programTpl from '../platform/program.tpl.cpp';

import preambleH from '../platform/preamble.h';
import intrusivePtrH from '../platform/intrusive_ptr.h';
import listH from '../platform/list.h';
import runtimeCpp from '../platform/runtime.cpp';

// =============================================================================
//
// Utils and helpers
//
// =============================================================================
const trimTrailingWhitespace = R.replace(/\s+$/gm, '\n');
const indexByPinKey = R.indexBy(R.prop('pinKey'));
const getPatchPins = direction => R.compose(
  indexByPinKey,
  R.path(['patch', direction])
);
const omitNullValues = R.map(R.when(
  R.propSatisfies(R.isNil, 'value'),
  R.omit(['value'])
));
const getNodePins = direction => R.compose(
  indexByPinKey,
  omitNullValues,
  R.prop(direction)
);
const mergeAndListPins = (direction, node) => R.compose(
  R.values,
  R.converge(
    R.mergeWith(R.merge),
    [
      getPatchPins(direction),
      getNodePins(direction),
    ]
  )
)(node);
// Merge patch pins data with node pins data
Handlebars.registerHelper('mergePins', function mergePins() {
  this.inputs = mergeAndListPins('inputs', this);
  this.outputs = mergeAndListPins('outputs', this);
});
// Generate patch-level namespace name
Handlebars.registerHelper('ns', R.compose(
  R.join('__'),
  R.props(['owner', 'libName', 'patchName'])
));
// Check that variable is not undefined
Handlebars.registerHelper('exists', function existsHelper(variable, options) {
  return (typeof variable !== 'undefined') ?
    options.fn(this) :
    options.inverse(this);
});
// Temporary switch to global C++ namespace
Handlebars.registerHelper('global', function global(options) {
  return [
    '// --- Enter global namespace ---',
    '}}',
    options.fn(this),
    'namespace xod {',
    `namespace ${this.owner}__${this.libName}__${this.patchName} {`,
    '// --- Back to local namespace ---',
  ].join('\n');
});

// =============================================================================
//
// Templates and settings
//
// =============================================================================
const renderingOptions = {
  noEscape: true,
  strict: true,
};

// Basic templates
const templates = {
  config: Handlebars.compile(configTpl, renderingOptions),
  patchContext: Handlebars.compile(patchContextTpl, renderingOptions),
  implList: Handlebars.compile(implListTpl, renderingOptions),
  program: Handlebars.compile(programTpl, renderingOptions),
};

// =============================================================================
//
// Rendering functions
//
// =============================================================================
export const renderConfig = def(
  'renderConfig :: TConfig -> String',
  templates.config
);
export const renderPatchContext = def(
  'renderPatchContext :: TPatch -> String',
  templates.patchContext
);
export const renderImpl = def(
  'renderImpl :: TPatch -> String',
  (data) => {
    const ctx = R.applySpec({
      owner: R.prop('owner'),
      libName: R.prop('libName'),
      patchName: R.prop('patchName'),
      GENERATED_CODE: renderPatchContext,
    })(data);

    const patchImpl = R.prop('impl', data);
    return Handlebars.compile(patchImpl, renderingOptions)(ctx);
  }
);
export const renderImplList = def(
  'renderImplList :: [TPatch] -> String',
  R.compose(
    trimTrailingWhitespace,
    templates.implList,
    R.map(
      R.applySpec({
        owner: R.prop('owner'),
        libName: R.prop('libName'),
        patchName: R.prop('patchName'),
        implementation: renderImpl,
      })
    )
  )
);

export const renderProgram = def(
  'renderProgram :: [TNode] -> String',
  nodes => trimTrailingWhitespace(
    templates.program({ nodes })
  )
);
export const renderProject = def(
  'renderProject :: TProject -> String',
  (project) => {
    const config = renderConfig(project.config);
    const impls = renderImplList(project.patches);
    const program = renderProgram(project.nodes);

    return R.join('\n')([
      preambleH,
      intrusivePtrH,
      listH,
      config,
      runtimeCpp,
      impls,
      program,
    ]);
  }
);
