# Shapefile Parser

Native Zig implementation for reading/writing `.shp`, `.shx`, and `.dbf` files. No C dependencies.

Priority geometry types: PointZ (dense surveyed pipe routes) and PolyLineZ (pipeline paths).

Includes KP (kilometer post) computation from consecutive survey points.

See [bathymetry-tool](https://github.com/Jerell/bathymetry-tool) for the Python prototype of this workflow.
