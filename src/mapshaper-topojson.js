/* @requires
mapshaper-common,
mapshaper-geojson,
mapshaper-topojson-import,
mapshaper-topojson-split
*/

MapShaper.topojson = TopoJSON;

MapShaper.importTopoJSON = function(obj, opts) {
  var round = opts && opts.precision ? getRoundingFunction(opts.precision) : null;

  if (Utils.isString(obj)) {
    obj = JSON.parse(obj);
  }
  var arcs = TopoJSON.importArcs(obj.arcs, obj.transform, round),
      layers = [];
  Utils.forEach(obj.objects, function(object, name) {
    var layerData = TopoJSON.importObject(object, arcs);
    var data;
    if (layerData.properties) {
      data = new DataTable(layerData.properties);
    }
    layers.push({
      name: name,
      data: data,
      shapes: layerData.shapes,
      geometry_type: layerData.geometry_type
    });
  });

  return {
    arcs: new ArcDataset(arcs),
    layers: layers
  };
};

// TODO: Support ids from attribute data
//
MapShaper.exportTopoJSON = function(layers, arcData, opts) {
  var topology = TopoJSON.exportTopology(layers, arcData, opts),
      topologies, files;
  if (opts.topojson_divide) {
    topologies = TopoJSON.splitTopology(topology);
    files = Utils.map(topologies, function(topo, name) {
      return {
        content: JSON.stringify(topo),
        name: name
      };
    });
  } else {
    files = [{
      content: JSON.stringify(topology),
      name: ""
    }];
  }
  return files;
};

TopoJSON.exportTopology = function(layers, arcData, opts) {
  var topology = {type: "Topology"},
      objects = {},
      filteredArcs = arcData.getFilteredCopy(),
      bounds = new Bounds(),
      transform, invTransform,
      arcArr, arcIdMap;

  if (opts.topojson_resolution === 0) {
    // no transform
  } else if (opts.topojson_resolution > 0) {
    transform = TopoJSON.getExportTransform(filteredArcs, opts.topojson_resolution);
  } else if (opts.precision > 0) {
    transform = TopoJSON.getExportTransformFromPrecision(filteredArcs, opts.precision);
  } else {
    transform = TopoJSON.getExportTransform(filteredArcs); // auto quantization
  }

  if (transform) {
    invTransform = transform.invert();
    topology.transform = {
      scale: [invTransform.mx, invTransform.my],
      translate: [invTransform.bx, invTransform.by]
    };
    filteredArcs.applyTransform(transform, !!"round");
    arcIdMap = TopoJSON.filterExportArcs(filteredArcs);
    arcArr = TopoJSON.exportDeltaEncodedArcs(filteredArcs);
  } else {
    arcIdMap = TopoJSON.filterExportArcs(filteredArcs);
    arcArr = TopoJSON.exportArcs(filteredArcs);
  }

  Utils.forEach(layers, function(lyr, i) {
    var geomType = lyr.geometry_type == 'polygon' ? 'MultiPolygon' : 'MultiLineString';
    var exporter = new PathExporter(filteredArcs, lyr.geometry_type == 'polygon'),
        shapes = lyr.shapes;
    if (arcIdMap) shapes = TopoJSON.remapShapes(shapes, arcIdMap);
    var name = lyr.name || "layer" + (i + 1);
    var obj = exportTopoJSONObject(exporter, geomType, shapes, lyr.data);
    var objectBounds = exporter.getBounds();
    if (invTransform) {
      objectBounds.transform(invTransform);
    }
    obj.bbox = objectBounds.toArray();
    objects[name] = obj;
    bounds.mergeBounds(objectBounds);
  });

  topology.objects = objects;
  topology.arcs = arcArr;
  topology.bbox = bounds.toArray();
  return topology;
};

// TODO: consider refactoring and combining with remapping code from
// mapshaper-topojson-split.js
//
TopoJSON.remapShapes = function(shapes, map) {
  return Utils.map(shapes, function(shape) {
    return shape ? TopoJSON.remapShape(shape, map) : null;
  });
};

// Re-index the arcs in a shape to account for removal of collapsed arcs
// Return arrays of remapped arcs; original arcs are unmodified.
//
TopoJSON.remapShape = function(src, map) {
  if (!src || src.length === 0) return [];
  var dest = [],
      arcIds, path, arcNum, arcId, k, inv;

  for (var pathId=0, numPaths=src.length; pathId < numPaths; pathId++) {
    path = src[pathId];
    arcIds = [];
    for (var i=0, n=path.length; i<n; i++) {
      arcNum = path[i];
      inv = arcNum < 0;
      arcId = inv ? ~arcNum : arcNum;
      k = map[arcId];
      if (k == -1) {
        //
      } else if (k <= arcId) {
        arcIds.push(inv ? ~k : k);
      } else {
        error("Arc index problem");
      }
    }
    if (arcIds.length > 0) {
      dest.push(arcIds);
    }
  }
  return dest;
};

// Remove collapsed arcs from @arcDataset (ArcDataset) and re-index remaining
// arcs.
// Return an array mapping original arc ids to new ids (See ArcDataset#filter())
//
TopoJSON.filterExportArcs = function(arcData) {
  var arcMap = arcData.filter(function(iter, i) {
    var x, y;
    if (iter.hasNext()) {
      x = iter.x;
      y = iter.y;
      while (iter.hasNext()) {
        if (iter.x !== x || iter.y !== y) return true;
      }
    }
    return false;
  });
  return arcMap;
};

// Export arcs as arrays of [x, y] coords without delta encoding
//
TopoJSON.exportArcs = function(arcData) {
  var arcs = [];
  arcData.forEach(function(iter, i) {
    var arc = [];
    while (iter.hasNext()) {
      arc.push([iter.x, iter.y]);
    }
    arcs.push(arc.length > 1 ? arc : null);
  });
  return arcs;
};

// Export arcs with delta encoding, as per the topojson spec.
//
TopoJSON.exportDeltaEncodedArcs = function(arcData) {
  var arcs = [];
  arcData.forEach(function(iter, i) {
    var arc = [],
        x = 0,
        y = 0;
    while (iter.hasNext()) {
      arc.push([iter.x - x, iter.y - y]);
      x = iter.x;
      y = iter.y;
    }
    arcs.push(arc.length > 1 ? arc : null);
  });
  return arcs;
};

// Return a Transform object for converting geographic coordinates to quantized
// integer coordinates.
//
TopoJSON.getExportTransform = function(arcData, quanta) {
  var srcBounds = arcData.getBounds(),
      destBounds, xmax, ymax;
  if (quanta) {
    xmax = quanta - 1;
    ymax = quanta - 1;
  } else {
    var resXY = TopoJSON.calcExportResolution(arcData);
    xmax = srcBounds.width() / resXY[0];
    ymax = srcBounds.height() / resXY[1];
  }
  // rounding xmax, ymax ensures original layer bounds don't change after 'quantization'
  // (this could matter if a layer extends to the poles or the central meridian)
  // TODO: test this
  destBounds = new Bounds(0, 0, Math.ceil(xmax), Math.ceil(ymax));
  return srcBounds.getTransform(destBounds);
};

TopoJSON.getExportTransformFromPrecision = function(arcData, precision) {
  var src = arcData.getBounds(),
      dest = new Bounds(0, 0, src.width() / precision, src.height() / precision),
      transform = src.getTransform(dest);
  return transform;
};

// Find the x, y values that map to x / y integer unit in topojson output
// Calculated as 1/50 the size of average x and y offsets
// (a compromise between compression, precision and simplicity)
//
TopoJSON.calcExportResolution = function(arcData) {
  // TODO: remove influence of long lines created by polar and antimeridian cuts
  var xy = arcData.getAverageSegment(),
      k = 0.02;
  return [xy[0] * k, xy[1] * k];
};

function exportTopoJSONObject(exporter, type, shapes, data) {
  var properties = data ? data.getRecords() : null,
      obj = {
        type: "GeometryCollection"
      };
  obj.geometries = Utils.map(shapes, function(shape, i) {
    var paths = exporter.exportShapeForTopoJSON(shape),
        geom = exportTopoJSONGeometry(paths, type);
    geom.id = i; // ids ? ids[i] : i;
    if (properties) {
      geom.properties = properties[i] || null;
    }
    return geom;
  });
  return obj;
}

function exportTopoJSONGeometry(paths, type) {
  var obj = {};

  if (!paths || paths.length === 0) {
    // null geometry
    obj.type = null;
  }
  else if (type == 'MultiPolygon') {
    if (paths.length == 1) {
      obj.type = "Polygon";
      obj.arcs = paths[0];
    } else {
      obj.type = "MultiPolygon";
      obj.arcs = paths;
    }
  }
  else if (type == "MultiLineString") {
    if (paths.length == 1) {
      obj.arcs = paths[0];
      obj.type = "LineString";
    } else {
      obj.arcs = paths;
      obj.type = "MultiLineString";
    }
  }
  else {
    error ("#exportTopoJSONGeometry() unsupported type:", type);
  }
  return obj;
}
