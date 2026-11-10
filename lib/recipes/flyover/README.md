# Flyover source and attribution

Orbit propagation (`terra.ts`), sphere lighting and projection (`earthface.ts`),
region lookup (`geography.ts`, `countries.json`) and station artwork are adapted
from [Baszert/trmnl-flyover](https://github.com/Baszert/trmnl-flyover), commit
`25288dfdf22112ae4a9c86dfa85beab50fc41868`, under the adjacent MIT license.
The secular J2 orbit approximation omits SGP4 short-period terms. It is suitable
for this display, not pass prediction or navigation. Elements older than 48 hours
are rejected. Country names are estimates from a coarse town grid and ocean mask.

Bundled `public/vendor/flyover/{albedo,lights}-2k.webp` come from
[Baszert/trmnl-earth](https://github.com/Baszert/trmnl-earth), commit
`ef4f86c41e7474b6e7a412a3c5ff2955bc069d12`. Their source imagery is NASA Earth
Observatory Blue Marble Next Generation and Black Marble 2016 (public domain).
Daily satellite imagery, when enabled, comes from NASA GIBS VIIRS SNPP corrected
reflectance. The date is 30 hours behind the snapshot to allow processing.

BYOS renders the globe on the server through Sharp and the ordinary React recipe
pipeline. No canvas, client JavaScript, remote scripts or browser renderer is
required. Orbit elements are cached in memory for eight hours with single-flight
requests. Daily cloud textures are cached for one hour (including unavailable
responses). All caches reset on a server restart. Optional NASA failures fall
back to bundled textures; orbit failures use the runtime's last-good-data policy.
The timestamp always identifies the snapshot, including stale frames.
