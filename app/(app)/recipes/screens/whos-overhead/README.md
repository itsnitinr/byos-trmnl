# Who’s Overhead?

Set your observer latitude/longitude, location label and radius in the recipe
settings. Defaults to central Bengaluru (12.9716, 77.5946), within 25 km.
Use a roughly one-minute playlist refresh when following aircraft; the display
is a snapshot, not a continuous radar. Times are explicitly UTC.

- Positions: https://api.adsb.lol/docs (15-second fetch cache).
- Optional callsign route and operator: https://www.adsbdb.com/ (one-hour cache).
  Routes are callsign lookups, not confirmed flight plans, and can be missing.
- Optional airline identification logos:
  https://github.com/Jxck-S/airline-logos (one-day cache). Logos remain the
  property of their respective owners. Missing logos leave a text header.
- Route-first monochrome layout with airline branding, model/registration,
  altitude, ground speed, track, and a compass-style relative-position locator.
  Compact screens show distance in place of the locator. No aircraft artwork.


The nearest aircraft by horizontal distance is selected. Ground reports,
positions older than 60 seconds, missing positions and out-of-radius reports
are excluded. Feeds older than two minutes are rejected. No coverage is not
proof of an empty physical sky; the empty state says no aircraft *reported*.
A feed failure has a separate state and never retains a misleading old flight.

Enable **demo** to preview a labelled KLM sample with route, type and logo.
Demo never requests live positions. Disable it for device use. No API key is
required. Fetches share a 7.5-second deadline, below the recipe runtime limit.
