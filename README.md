# Dean RA Pump Selector

Enter flow, head, fluid, and temperature. The page recommends one Dean RA power frame, size, and eighth-inch impeller trim when a catalog curve covers the duty.

Water at ambient is the reference the curves were drawn for, and it stays the default. Another fluid uses the Hydraulic Institute preliminary correction (ANSI/HI 9.6.7) of that same water curve, from the viscosity and specific gravity stored for the fluid at its listed temperature. The result is labeled as a correction, not a Dean sheet. If a fluid has no stored viscosity or specific gravity at the temperature entered, the page says so and does not invent them. These curves are not a direct duplicate of Dean's and are for reference only.

The catalog points live in `data/dean-ra-curves.json`. Points marked `inferred` were read through a label or a crossing, about ±3 ft. This catalog does not include pumps larger than 10 in, so a better Dean size may exist above that.
