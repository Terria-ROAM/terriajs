import { Cartesian3 } from "cesium";
import { Quaternion } from "cesium";
import { BillboardGraphics } from "cesium";
import { PointGraphics } from "cesium";

export default interface VehicleData {
  /**
   * Where to put the vehicle.
   */
  position?: Cartesian3;

  /**
   * Image to draw to represent the vehicle
   */
  billboard?: BillboardGraphics;

  /**
   * Point to draw to represent the vehicle
   */
  point?: PointGraphics;

  /**
   * Unique identifier of this data in its source system.
   */
  sourceId?: string;

  /**
   * Transformation of the vehicle 3D model.
   */
  orientation?: Quaternion;

  /**
   * Key-value pairs to populate the feature info template with.
   */
  featureInfo?: Map<string, any>;
}
