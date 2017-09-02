import R from 'ramda';
import React from 'react';
import PropTypes from 'prop-types';
import $ from 'sanctuary-def';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import { HotKeys, FocusTrap } from 'react-hotkeys';
import { Patch as PatchType } from 'xod-project';
import { $Maybe } from 'xod-func-tools';

import * as Actions from '../actions';
import * as ProjectActions from '../../project/actions';
import * as ProjectSelectors from '../../project/selectors';
import * as EditorSelectors from '../selectors';

import { isInput } from '../../utils/browser';
import { COMMAND } from '../../utils/constants';
import { EDITOR_MODE, FOCUS_AREAS } from '../constants';

import Patch from './Patch';
import NoPatch from '../components/NoPatch';
import Suggester from '../components/Suggester';
import ProjectBrowser from '../../projectBrowser/containers/ProjectBrowser';
import Sidebar from '../../utils/components/Sidebar';
import Workarea from '../../utils/components/Workarea';

import { RenderableSelection } from '../../project/types';
import sanctuaryPropType from '../../utils/sanctuaryPropType';

import Tabs from '../containers/Tabs';
import Helpbar from '../containers/Helpbar';
import Inspector from '../components/Inspector';

class Editor extends React.Component {
  constructor(props) {
    super(props);

    this.setModeDefault = this.setModeDefault.bind(this);
    this.getHotkeyHandlers = this.getHotkeyHandlers.bind(this);
    this.toggleHelpbar = this.toggleHelpbar.bind(this);
    this.onAddNode = this.onAddNode.bind(this);
    this.showSuggester = this.showSuggester.bind(this);
    this.hideSuggester = this.hideSuggester.bind(this);

    this.patchSize = this.props.size;
  }

  onAddNode(patchPath) {
    // TODO: rewrite this when implementing "zombie" nodes
    const position = this.props.suggesterPlacePosition || this.props.defaultNodePosition;

    this.hideSuggester();
    this.props.actions.addNode(
      patchPath,
      position,
      this.props.currentPatchPath
    );
  }

  setModeDefault() {
    this.props.actions.setMode(EDITOR_MODE.DEFAULT);
  }

  getHotkeyHandlers() {
    return {
      [COMMAND.SET_MODE_DEFAULT]: this.setModeDefault,
      [COMMAND.UNDO]: () => this.props.actions.undo(this.props.currentPatchPath),
      [COMMAND.REDO]: () => this.props.actions.redo(this.props.currentPatchPath),
      [COMMAND.TOGGLE_HELPBAR]: this.toggleHelpbar,
      [COMMAND.INSERT_NODE]: (event) => {
        if (isInput(event)) return;
        this.showSuggester(null);
      },
    };
  }

  toggleHelpbar(e) {
    if (isInput(e)) return;

    this.props.actions.toggleHelpbar();
  }

  showSuggester(placePosition) {
    this.props.actions.showSuggester(placePosition);
  }

  hideSuggester() {
    this.props.actions.hideSuggester();
  }


  render() {
    const {
      currentPatchPath,
      currentPatch,
      selection,
      patchesIndex,
    } = this.props;

    const openedPatch = currentPatchPath
      ? (
        <Patch
          patchPath={currentPatchPath}
          size={this.patchSize}
          onDoubleClick={this.showSuggester}
        />
      ) : (
        <NoPatch />
      );

    const suggester = (this.props.suggesterIsVisible) ? (
      <Suggester
        addClassName={(this.props.isHelpbarVisible) ? 'with-helpbar' : ''}
        index={patchesIndex}
        onAddNode={this.onAddNode}
        onBlur={this.hideSuggester}
        onHighlight={this.props.actions.highlightSugessterItem}
      />
    ) : null;

    return (
      <HotKeys handlers={this.getHotkeyHandlers()} className="Editor">
        <Sidebar>
          <FocusTrap onFocus={() => this.props.actions.setFocusedArea(FOCUS_AREAS.PROJECT_BROWSER)}>
            <ProjectBrowser />
          </FocusTrap>
          <FocusTrap onFocus={() => this.props.actions.setFocusedArea(FOCUS_AREAS.INSPECTOR)}>
            <Inspector
              selection={selection}
              currentPatch={currentPatch}
              onPropUpdate={this.props.actions.updateNodeProperty}
              onPatchDescriptionUpdate={this.props.actions.updatePatchDescription}
            />
          </FocusTrap>
        </Sidebar>
        <FocusTrap onFocus={() => this.props.actions.setFocusedArea(FOCUS_AREAS.WORKAREA)}>
          <Workarea>
            <Tabs />
            {openedPatch}
            {suggester}
          </Workarea>
        </FocusTrap>
        <Helpbar />
      </HotKeys>
    );
  }
}

Editor.propTypes = {
  size: PropTypes.object.isRequired,
  selection: sanctuaryPropType($.Array(RenderableSelection)),
  currentPatchPath: PropTypes.string,
  currentPatch: sanctuaryPropType($Maybe(PatchType)),
  patchesIndex: PropTypes.object,
  isHelpbarVisible: PropTypes.bool,
  suggesterIsVisible: PropTypes.bool,
  suggesterPlacePosition: PropTypes.object,
  defaultNodePosition: PropTypes.object.isRequired,
  actions: PropTypes.shape({
    updateNodeProperty: PropTypes.func.isRequired,
    updatePatchDescription: PropTypes.func.isRequired,
    undo: PropTypes.func.isRequired,
    redo: PropTypes.func.isRequired,
    setMode: PropTypes.func.isRequired,
    toggleHelpbar: PropTypes.func.isRequired,
    setFocusedArea: PropTypes.func.isRequired,
    addNode: PropTypes.func.isRequired,
    showSuggester: PropTypes.func.isRequired,
    hideSuggester: PropTypes.func.isRequired,
    highlightSugessterItem: PropTypes.func.isRequired,
  }),
};

const mapStateToProps = R.applySpec({
  selection: ProjectSelectors.getRenderableSelection,
  currentPatch: ProjectSelectors.getCurrentPatch,
  currentPatchPath: EditorSelectors.getCurrentPatchPath,
  patchesIndex: ProjectSelectors.getPatchSearchIndex,
  suggesterIsVisible: EditorSelectors.isSuggesterVisible,
  suggesterPlacePosition: EditorSelectors.getSuggesterPlacePosition,
  isHelpbarVisible: EditorSelectors.isHelpbarVisible,
  defaultNodePosition: EditorSelectors.getDefaultNodePlacePosition,
});

const mapDispatchToProps = dispatch => ({
  actions: bindActionCreators({
    updateNodeProperty: ProjectActions.updateNodeProperty,
    updatePatchDescription: ProjectActions.updatePatchDescription,
    undo: ProjectActions.undoPatch,
    redo: ProjectActions.redoPatch,
    setMode: Actions.setMode,
    toggleHelpbar: Actions.toggleHelpbar,
    setFocusedArea: Actions.setFocusedArea,
    addNode: ProjectActions.addNode,
    showSuggester: Actions.showSuggester,
    hideSuggester: Actions.hideSuggester,
    highlightSugessterItem: Actions.highlightSugessterItem,
  }, dispatch),
});

export default connect(mapStateToProps, mapDispatchToProps)(Editor);
