# Dean RA Pump Selector

Enter flow, head, fluid, and temperature. The page lists every Dean RA size in this catalog that can meet the duty: power frame (RA2096, RA3146, or RA3186), size, impeller trim, and where the duty sits on that curve.

The list is ordered by where the duty sits on the curve. It is not ranked by efficiency. A duty in the middle-right of that size's catalog flow range comes first. A duty on the left side of the curve ranks lower, and a duty at the far right end ranks lower too. The curve sheets do not include efficiency, so this list can differ from IntelliQuip.

Water at ambient is the reference the curves were drawn for. Choosing another fluid does not change the plot: the curve on screen is still the catalog water curve. There is no viscosity correction. RA and RWA share the same head-capacity curve.

The catalog points live in `data/dean-ra-curves.json`. Points marked `inferred` were read through a label or a crossing, about ±3 ft. Points marked `interpolated` are samples of a monotone cubic spline through those catalog points. They stay inside the measured flow range and are not new sheet readings. Head does not rise as flow increases. This catalog does not include pumps larger than 10 in, so a better Dean size may still exist above 10 in.

`data/intelliquip-selections.json` holds duty-specific IntelliQuip values that were supplied for a size. Those numbers are labeled IntelliQuip on the matching row. They are not curve-sheet readings and they are not used to draw the head-capacity curve.
