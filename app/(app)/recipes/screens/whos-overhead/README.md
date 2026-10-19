# Who’s Overhead?

Set your observer latitude/longitude, location label and radius in the recipe
settings. Defaults to central Bengaluru (12.9716, 77.5946), within 25 km.
Use a roughly one-minute playlist refresh when following aircraft; the display
is a snapshot, not a continuous radar. Times are explicitly UTC.

- Positions: https://api.adsb.lol/docs (15-second fetch cache).
- Optional callsign route and operator: https://www.adsbdb.com/ (one-hour cache).
  Routes are callsign lookups, not confirmed flight plans, and can be missing.
  Route and logo lookups are optional fetches, so a miss never discards the
  live position.
- Optional airline identification logos:
  https://github.com/Jxck-S/airline-logos (one-day cache). Logos remain the
  property of their respective owners. Missing logos leave a text header.
- Optional airport coordinates from the same lookup drive route progress (km
  flown and to go). Without them the route track is drawn without the plane.

## Layout

- **Sky scope.** North-up range rings sized to your radius. Every aircraft in
  range (up to 13) is drawn as a plane pointing along its track. The nearest is
  solid, tagged with its callsign, and shows a hatched sweep and a dashed
  two-minute projected path at its current ground speed.
- **Flight.** Airline mark, callsign, and a climbing/descending/cruising tag
  from the reported vertical rate. Then a route card: airport codes, a progress
  track with the plane on it, the cities, and the distance left. Then the
  airframe model and registration.
- **Stats.** Altitude with a 0–45,000 ft bar, ground speed in knots and km/h,
  and the distance with an arrow pointing where to look.

Portrait and half screens stack the scope above the details and give it all
the height the details leave. Half screens drop the progress percentage,
distance left and airframe row. Artwork is black and white only, with
2px-or-heavier strokes, so it stays crisp on 1-bit panels.


The nearest aircraft by horizontal distance is selected. Ground reports,
positions older than 60 seconds, missing positions and out-of-radius reports
are excluded. Feeds older than two minutes are rejected. No coverage is not
proof of an empty physical sky; the empty state says no aircraft *reported*.
A feed failure has a separate state and never retains a misleading old flight.

Enable **demo** to preview a labelled Emirates SIN→DXB sample cruising over
Bengaluru, with route progress, type, logo and surrounding traffic.
Demo never requests live positions. Disable it for device use. No API key is
required. Fetches share a 7.5-second deadline, below the recipe runtime limit.
