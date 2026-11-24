# Dean RA Pump Selector

Enter flow, head, fluid, and temperature. The page lists every Dean RA size in this catalog that can meet the duty: power frame (RA2096, RA3146, or RA3186), size, impeller trim, and where the duty sits on that curve.

The list is ordered by efficiency. 70 to 120 percent of best efficiency point is preferred, 50 to 130 percent is allowable, and a duty below 50 percent is flagged. Each row shows percent of BEP, brake horsepower, the motor, and NPSHr when that speed has a curve. Choose 3500, 1750, or 1150 rpm. The 1750 and 1150 curves are the charts in the data pak. NPSHr is never scaled from another speed. These curves apply only up to 70 SSU.

Water at ambient is the reference the curves were drawn for, and it stays the default. Another fluid uses the Hydraulic Institute preliminary correction (ANSI/HI 9.6.7) of that same water curve, from the viscosity and specific gravity stored for the fluid at its listed temperature. The result is labeled as a correction, not a Dean sheet. If a fluid has no stored viscosity or specific gravity at the temperature entered, the page says so and does not invent them. These curves are not a direct duplicate of Dean's and are for reference only. RA and RWA share the same head-capacity curve.

The catalog points live in `data/dean-ra-curves.json`. They were read from the Dean data pak on the printed grid. Page 22 uses the 100 to 450 ft head scale. A line ends where the printed stroke ends. A trim is D squared interpolation at constant flow between the two bracketing lines. This catalog does not include pumps larger than 10 in, so a better Dean size may still exist above 10 in.

`data/intelliquip-selections.json` holds duty-specific IntelliQuip values that were supplied for a size. Those numbers are labeled IntelliQuip on the matching row. They are not curve-sheet readings and they are not used to draw the head-capacity curve.
