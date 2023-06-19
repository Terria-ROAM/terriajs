import { get as _get } from "lodash-es";
import {
  computed,
  IReactionDisposer,
  makeObservable,
  observable,
  runInAction
} from "mobx";
import { createTransformer, ITransformer } from "mobx-utils";
import Pbf from "pbf";
import { Axis } from "cesium";
import { Cartesian3 } from "cesium";
import { Color } from "cesium";
import { HeadingPitchRoll } from "cesium";
import { JulianDate } from "cesium";
import { NearFarScalar } from "cesium";
import { Transforms } from "cesium";
import { BillboardGraphics } from "cesium";
import { ConstantPositionProperty } from "cesium";
import { ConstantProperty } from "cesium";
import { CustomDataSource, DataSource } from "cesium";
import { Entity } from "cesium";
import { ModelGraphics } from "cesium";
import { PointGraphics } from "cesium";
import { PropertyBag } from "cesium";
import { ColorBlendMode } from "cesium";
import { HeightReference } from "cesium";
import { ShadowMode } from "cesium";
import isDefined from "../../../Core/isDefined";
import loadArrayBuffer from "../../../Core/loadArrayBuffer";
import TerriaError from "../../../Core/TerriaError";
import AutoRefreshingMixin from "../../../ModelMixins/AutoRefreshingMixin";
import CatalogMemberMixin from "../../../ModelMixins/CatalogMemberMixin";
import MappableMixin from "../../../ModelMixins/MappableMixin";
import UrlMixin from "../../../ModelMixins/UrlMixin";
import GtfsCatalogItemTraits from "../../../Traits/TraitsClasses/GtfsCatalogItemTraits";
import { RectangleTraits } from "../../../Traits/TraitsClasses/MappableTraits";
import CreateModel from "../../Definition/CreateModel";
import createStratumInstance from "../../Definition/createStratumInstance";
import LoadableStratum from "../../Definition/LoadableStratum";
import { BaseModel } from "../../Definition/Model";
import StratumOrder from "../../Definition/StratumOrder";
import Terria from "../../Terria";
import proxyCatalogItemUrl from "../proxyCatalogItemUrl";
import {
  FeedEntity,
  FeedMessage,
  FeedMessageReader
} from "./GtfsRealtimeProtoBufReaders";
import prettyPrintGtfsEntityField from "./prettyPrintGtfsEntityField";
import VehicleData from "./VehicleData";

interface RectangleExtent {
  east: number;
  south: number;
  west: number;
  north: number;
}

class GtfsStratum extends LoadableStratum(GtfsCatalogItemTraits) {
  static stratumName = "gtfs";

  constructor(private readonly _item: GtfsCatalogItem) {
    super();
    makeObservable(this);
  }

  duplicateLoadableStratum(newModel: BaseModel): this {
    return new GtfsStratum(newModel as GtfsCatalogItem) as this;
  }

  static async load(item: GtfsCatalogItem) {
    return new GtfsStratum(item);
  }

  @computed
  get rectangle() {
    return createStratumInstance(RectangleTraits, this._item._bbox);
  }
}

StratumOrder.addLoadStratum(GtfsStratum.stratumName);

/**
 * For displaying realtime transport data. See [here](https://developers.google.com/transit/gtfs-realtime/reference/)
 * for the spec.
 */
export default class GtfsCatalogItem extends UrlMixin(
  AutoRefreshingMixin(
    MappableMixin(CatalogMemberMixin(CreateModel(GtfsCatalogItemTraits)))
  )
) {
  disposer: IReactionDisposer | undefined;

  _bbox: RectangleExtent = {
    west: Infinity,
    south: Infinity,
    east: -Infinity,
    north: -Infinity
  };
  /**
   * Always use the getter to read this. This is a cache for a computed property.
   *
   * We cache it because recreating it reactively is computationally expensive, so we modify it reactively instead.
   */
  _private_dataSource: DataSource = new CustomDataSource("billboard");

  static readonly _protected_FEATURE_INFO_TEMPLATE_FIELDS: string[] = [
    "route_short_name",
    "occupancy_status#str",
    "speed#km",
    "speed",
    "bearing"
  ];

  static get type() {
    return "gtfs";
  }

  get type() {
    return GtfsCatalogItem.type;
  }

  @observable
  _protected_gtfsFeedEntities: FeedEntity[] = [];

  _protected_convertManyFeedEntitiesToBillboardData: ITransformer<
    FeedEntity[],
    VehicleData[]
  > = createTransformer((feedEntities: FeedEntity[]) => {
    // Sometimes the feed can contain many records for the same vehicle
    // so we'll only display the newest record.
    // Although technically the timestamp property is optional, if none is
    // present we'll show the record.
    const vehicleMap = new Map();
    for (var i = 0; i < feedEntities.length; ++i) {
      const entity: FeedEntity = feedEntities[i];
      const item: VehicleData =
        this._protected_convertFeedEntityToBillboardData(entity);

      if (item && item.position && item.featureInfo) {
        const vehicleInfo = item.featureInfo.get("entity").vehicle.vehicle;
        if (vehicleMap.has(vehicleInfo.id) && vehicleInfo.timestamp) {
          let existingRecord = vehicleMap.get(vehicleInfo.id);
          if (existingRecord.timestamp < vehicleInfo.timestamp) {
            vehicleMap.set(vehicleInfo.id, item);
          }
        } else {
          vehicleMap.set(vehicleInfo.id, item);
        }
      }
    }
    return [...vehicleMap.values()];
  });

  @computed
  get _protected_dataSource(): DataSource {
    this._private_dataSource.entities.suspendEvents();

    // Convert the GTFS protobuf into a more useful shape
    const vehicleData: VehicleData[] =
      this._protected_convertManyFeedEntitiesToBillboardData(
        this._protected_gtfsFeedEntities
      );
    for (let data of vehicleData) {
      if (data.sourceId === undefined) {
        continue;
      }

      const entity: Entity =
        this._private_dataSource.entities.getOrCreateEntity(data.sourceId);

      if (!entity.model) {
        if (this._private_coloredModels) {
          const gtfsEntity: FeedEntity = data.featureInfo?.get("entity");
          const value = _get(
            gtfsEntity,
            this.model.colorModelsByProperty.property!
          );
          if (value !== undefined) {
            const index =
              this.model.colorModelsByProperty.colorGroups.findIndex(
                (colorGroup) =>
                  colorGroup.regExp !== undefined &&
                  new RegExp(colorGroup.regExp).test(value)
              );
            if (index !== -1) {
              entity.model = this._private_coloredModels[index];
            }
            entity.point = undefined;
          } else {
            entity.model = this._private_model;
          }
        } else if (this._private_model) {
          entity.model = this._private_model;
        }
      }

      if (
        this.model !== undefined &&
        this.model !== null &&
        data.orientation !== undefined &&
        data.orientation !== null
      ) {
        entity.orientation = new ConstantProperty(data.orientation);
      }

      if (
        data.position !== undefined &&
        (!entity.position ||
          entity.position.getValue(new JulianDate()) !== data.position)
      ) {
        entity.position = new ConstantPositionProperty(data.position);
      }

      // If we're using a billboard
      if (data.billboard !== null && data.billboard !== undefined) {
        if (entity.billboard === null || entity.billboard === undefined) {
          entity.billboard = data.billboard;
        }

        if (data.billboard.color) {
          data.billboard.color.getValue(new JulianDate()).alpha = this.opacity;
        }

        if (
          !entity.billboard.color ||
          !entity.billboard.color.equals(data.billboard.color)
        ) {
          entity.billboard.color = data.billboard.color;
        }
      }

      // If we're using a point
      if (data.point !== null && data.point !== undefined) {
        if (entity.point === null || entity.point === undefined) {
          entity.point = data.point;
        }

        if (data.point.color) {
          data.point.color.getValue(new JulianDate()).alpha = this.opacity;
        }

        if (
          !entity.point.color ||
          !entity.point.color.equals(data.point.color)
        ) {
          entity.point.color = data.point.color;
        }
      }

      if (data.featureInfo !== undefined && data.featureInfo !== null) {
        entity.properties = new PropertyBag();

        for (let key of data.featureInfo.keys()) {
          entity.properties.addProperty(key, data.featureInfo.get(key));
        }
      }
    }

    // remove entities that no longer exist
    if (this._private_dataSource.entities.values.length > vehicleData.length) {
      const idSet = new Set(vehicleData.map((val) => val.sourceId));

      this._private_dataSource.entities.values
        .filter((entity) => !idSet.has(entity.id))
        .forEach((entity) => this._private_dataSource.entities.remove(entity));
    }

    this._private_dataSource.entities.resumeEvents();

    return this._private_dataSource;
  }

  refreshData() {
    this._protected_forceLoadMapItems();
  }

  @computed
  get mapItems(): DataSource[] {
    this._private_dataSource.show = this.show;
    return [this._protected_dataSource];
  }

  @computed
  get _private_cesiumUpAxis() {
    if (this.model.upAxis === undefined) {
      return Axis.Y;
    }
    return Axis.fromName(this.model.upAxis);
  }

  @computed
  get _private_cesiumForwardAxis() {
    if (this.model.forwardAxis === undefined) {
      return Axis.Z;
    }
    return Axis.fromName(this.model.forwardAxis);
  }

  @computed
  get _private_model() {
    if (this.model.url === undefined) {
      return undefined;
    }

    const options = {
      uri: new ConstantProperty(this.model.url),
      upAxis: new ConstantProperty(this._private_cesiumUpAxis),
      forwardAxis: new ConstantProperty(this._private_cesiumForwardAxis),
      scale: new ConstantProperty(this.model.scale ?? 1),
      heightReference: new ConstantProperty(HeightReference.RELATIVE_TO_GROUND),
      distanceDisplayCondition: new ConstantProperty({
        near: 0.0,
        far: this.model.maximumDistance
      }),
      maximumScale: new ConstantProperty(this.model.maximumScale),
      minimumPixelSize: new ConstantProperty(this.model.minimumPixelSize ?? 0),
      shadows: ShadowMode.DISABLED
    };

    return new ModelGraphics(options);
  }

  @computed
  get _private_coloredModels() {
    const colorGroups = this.model?.colorModelsByProperty?.colorGroups;
    const model = this._private_model;
    if (
      !isDefined(model) ||
      !isDefined(this.model?.colorModelsByProperty?.property) ||
      !isDefined(colorGroups) ||
      colorGroups.length === 0
    ) {
      return undefined;
    }
    return colorGroups.map(({ color }) => {
      const coloredModel = model.clone();
      coloredModel.color = new ConstantProperty(
        Color.fromCssColorString(color ?? "white")
      );
      coloredModel.colorBlendMode = new ConstantProperty(ColorBlendMode.MIX);
      coloredModel.colorBlendAmount = new ConstantProperty(0.7);
      return coloredModel;
    });
  }

  constructor(
    id: string | undefined,
    terria: Terria,
    sourceReference?: BaseModel
  ) {
    super(id, terria, sourceReference);
    makeObservable(this);
  }

  _protected_forceLoadMetadata(): Promise<void> {
    return Promise.resolve();
  }

  override _protected_forceLoadMapItems(): Promise<void> {
    if (this.strata.get(GtfsStratum.stratumName) === undefined) {
      GtfsStratum.load(this).then((stratum) => {
        runInAction(() => {
          this.strata.set(GtfsStratum.stratumName, stratum);
        });
      });
    }
    const promise: Promise<void> = this._protected_retrieveData()
      .then((data: FeedMessage) => {
        runInAction(() => {
          if (data.entity !== undefined && data.entity !== null) {
            this._protected_gtfsFeedEntities = data.entity;
            this.terria.currentViewer.notifyRepaintRequired();
          }
        });
      })
      .catch((e: Error) => {
        throw new TerriaError({
          title: `Could not load ${this.nameInCatalog}.`,
          sender: this,
          message: `There was an error loading the data for ${this.nameInCatalog}.`
        });
      });

    return promise;
  }

  _protected_retrieveData(): Promise<FeedMessage> {
    // These headers work for the Transport for NSW APIs. Presumably, other services will require different headers.
    const headers: any = {
      "Content-Type": "application/x-google-protobuf;charset=UTF-8",
      "Cache-Control": "no-cache"
    };

    if (this.headers !== undefined) {
      this.headers.forEach(({ name, value }) => {
        if (name !== undefined && value !== undefined) headers[name] = value;
      });
    }

    if (this.url !== null && this.url !== undefined) {
      return loadArrayBuffer(proxyCatalogItemUrl(this, this.url), headers).then(
        (arr: ArrayBuffer) => {
          const pbfBuffer = new Pbf(new Uint8Array(arr));
          return new FeedMessageReader().read(pbfBuffer);
        }
      );
    } else {
      return Promise.reject();
    }
  }

  _protected_convertFeedEntityToBillboardData(entity: FeedEntity): VehicleData {
    if (entity.id == undefined) {
      return {};
    }
    let position = undefined;
    let orientation = undefined;
    let featureInfo: Map<string, any> = new Map();
    if (
      entity.vehicle !== null &&
      entity.vehicle !== undefined &&
      entity.vehicle.position !== null &&
      entity.vehicle.position !== undefined &&
      entity.vehicle.position.latitude !== null &&
      entity.vehicle.position.latitude !== undefined &&
      entity.vehicle.position.longitude !== null &&
      entity.vehicle.position.longitude !== undefined &&
      entity.vehicle.position.bearing !== null &&
      entity.vehicle.position.bearing !== undefined
    ) {
      updateBbox(
        entity.vehicle.position.latitude,
        entity.vehicle.position.longitude,
        this._bbox
      );
      position = Cartesian3.fromDegrees(
        entity.vehicle.position.longitude,
        entity.vehicle.position.latitude
      );
      orientation = Transforms.headingPitchRollQuaternion(
        position,
        HeadingPitchRoll.fromDegrees(
          entity.vehicle.position.bearing - 90.0,
          0.0,
          0.0
        )
      );
    }

    // Add the values that the feature info template gets populated with
    for (let field of GtfsCatalogItem._protected_FEATURE_INFO_TEMPLATE_FIELDS) {
      featureInfo.set(field, prettyPrintGtfsEntityField(field, entity));
    }
    featureInfo.set("entity", entity);
    let billboard;
    let point;

    if (this.image !== undefined && this.image !== null) {
      billboard = new BillboardGraphics({
        image: new ConstantProperty(this.image),
        heightReference: new ConstantProperty(
          HeightReference.RELATIVE_TO_GROUND
        ),
        scaleByDistance:
          this.scaleImageByDistance.nearValue ===
          this.scaleImageByDistance.farValue
            ? undefined
            : new ConstantProperty(
                new NearFarScalar(
                  this.scaleImageByDistance.near,
                  this.scaleImageByDistance.nearValue,
                  this.scaleImageByDistance.far,
                  this.scaleImageByDistance.farValue
                )
              ),
        scale:
          this.scaleImageByDistance.nearValue ===
            this.scaleImageByDistance.farValue &&
          this.scaleImageByDistance.nearValue !== 1.0
            ? new ConstantProperty(this.scaleImageByDistance.nearValue)
            : undefined,
        color: new ConstantProperty(new Color(1.0, 1.0, 1.0, this.opacity))
      });
    } else {
      point = new PointGraphics({
        color: new ConstantProperty(Color.CYAN),
        outlineWidth: new ConstantProperty(1),
        outlineColor: new ConstantProperty(Color.WHITE),
        scaleByDistance:
          this.scaleImageByDistance.nearValue ===
          this.scaleImageByDistance.farValue
            ? undefined
            : new ConstantProperty(
                new NearFarScalar(
                  this.scaleImageByDistance.near,
                  this.scaleImageByDistance.nearValue,
                  this.scaleImageByDistance.far,
                  this.scaleImageByDistance.farValue
                )
              ),
        pixelSize:
          this.scaleImageByDistance.nearValue ===
            this.scaleImageByDistance.farValue &&
          this.scaleImageByDistance.nearValue !== 1.0
            ? new ConstantProperty(32 * this.scaleImageByDistance.nearValue)
            : new ConstantProperty(32),
        heightReference: new ConstantProperty(
          HeightReference.RELATIVE_TO_GROUND
        )
      });
    }

    return {
      sourceId: entity.id,
      position: position,
      orientation: orientation,
      featureInfo: featureInfo,
      billboard: billboard,
      point: point
    };
  }
}

function updateBbox(lat: number, lon: number, rectangle: RectangleExtent) {
  if (lon < rectangle.west) rectangle.west = lon;
  if (lat < rectangle.south) rectangle.south = lat;
  if (lon > rectangle.east) rectangle.east = lon;
  if (lat > rectangle.north) rectangle.north = lat;
}
