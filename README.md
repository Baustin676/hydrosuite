# Dean RA Pump Selector

Enter flow, head, fluid, and temperature. The page recommends one Dean RA power frame, size, and eighth-inch impeller trim when a catalog curve covers the duty.

Water at ambient is the reference the curves were drawn for. Choosing another fluid does not change the plot: the curve on screen is still the catalog water curve. There is no viscosity correction.

The catalog points live in `data/dean-ra-curves.json`. Points marked `inferred` were read through a label or a crossing, about ±3 ft. This catalog does not include pumps larger than 10 in, so a better Dean size may exist above that.
