import { defined } from "cesium";
import CesiumDragPoints from "./CesiumDragPoints";
import LeafletDragPoints from "./LeafletDragPoints";
import ViewerMode from "../../Models/ViewerMode";

/**
 * Callback for when a point is moved.
 * @callback PointMovedCallback
 * @param {CustomDataSource} customDataSource Contains all point entities that user has selected so far
 */

/**
 * For letting user drag existing points, altering their position without creating or destroying them. Works for all
 *
 * @alias DragPoints
 * @constructor
 *
 * ViewerModes.
 * @param {Terria} terria The Terria instance.
 * @param {PointMovedCallback} pointMovedCallback A function that is called when a point is moved.
 */
class DragPoints {
  constructor(terria, pointMovedCallback) {
    this._terria = terria;
    this._createDragPointsHelper(pointMovedCallback);

    var that = this;
    // It's possible to change viewerMode while mid-drawing, but in that case we need to change the dragPoints helper.
    this._terria.mainViewer.afterViewerChanged.addEventListener(function () {
      that._createDragPointsHelper(pointMovedCallback);
      that.setUp();
    });
  }

  /**
   * Set up the drag point helper. Note that this might happen when a drawing exists if the user has changed viewerMode.
   */
  setUp() {
    this._dragPointsHelper.setUp();
    if (defined(this._entities)) {
      this._dragPointsHelper.updateDraggableObjects(this._entities);
    }
  }

  /**
   * The drag count is an indication of how long the user dragged for. If it's really small, perhaps the user clicked,
   * but a mousedown/mousemove/mouseup event trio was triggered anyway. It solves a problem where in leaflet the click
   * event triggers even if the point has been dragged because it lets us determine whether the point was really dragged.
   */
  getDragCount() {
    return this._dragPointsHelper.dragCount;
  }

  /**
   * Reset drag count to 0, to indicate the user hasn't dragged.
   */
  resetDragCount() {
    this._dragPointsHelper.dragCount = 0;
  }

  /**
   * Update the list of draggable objects with a new list of entities that are able to be dragged. We are only interested
   * in entities that the user has drawn.
   *
   * @param {CustomDataSource} entities Entities that user has drawn on the map.
   */
  updateDraggableObjects(entities) {
    this._entities = entities;
    this._dragPointsHelper.updateDraggableObjects(entities);
  }

  /**
   * Create the drag point helper based on which viewerMode is active.
   * @param {PointMovedCallback} pointMovedCallback A function that is called when a point is moved.
   * @private
   */
  _createDragPointsHelper(pointMovedCallback) {
    if (defined(this._dragPointsHelper)) {
      this._dragPointsHelper.destroy();
    }
    if (this._terria.viewerMode === ViewerMode.Leaflet) {
      this._dragPointsHelper = new LeafletDragPoints(
        this._terria,
        pointMovedCallback
      );
    } else {
      this._dragPointsHelper = new CesiumDragPoints(
        this._terria,
        pointMovedCallback
      );
    }
  }
}

export default DragPoints;
