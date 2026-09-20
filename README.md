# Smart Outage Management Solution – City of Tshwane

A complete, working end-to-end web application that demonstrates a real-time outage management platform connecting customers, dispatchers, technicians and municipal operations teams.

**Ready for GitHub Pages** – pure HTML, CSS and JavaScript. No build step, no backend required. All data is stored in the browser (`localStorage`).

## Live Demo Flow

```
Report outage → Verify/Deduplicate → Prioritise → Dispatch → Assign technician
→ Track → Repair → Notify customer → Close → Analyse
```

## Features Implemented

| Requirement | How it works |
|-------------|--------------|
| **Report outages** | Form captures account number, location (map pin), contact details, type, severity, affected customers and time. |
| **Detect duplicate reports** | Haversine distance check (~800 m) + same account within 2 hours. Warns and links reports. |
| **Prioritise outages** | Score based on severity, number of affected customers and age of report. Queue sorted by priority. |
| **Dispatch technicians** | Dispatcher console with prioritised queue and one-click / smart assignment. |
| **Assign jobs intelligently** | Matches nearest available technician considering location + current workload + duty status. |
| **Track repairs in real time** | Leaflet map + GPS simulation (technician can “move” toward the job). Status updates: En Route → Nearby → On Site → In Progress. |
| **Keep customers informed** | Automatic notification log (SMS/email simulation) at every status change. |
| **Manage changes** | Record delays, postponements, reassignment and reasons via status update. |
| **Close jobs** | Capture work performed, technician notes and completion time. Frees technician capacity. |
| **Generate insights** | Dashboard stats, Chart.js analytics (status, severity, type, response times), hotspot areas, export JSON. |

## Quick Start

1. Clone or download this repository.
2. Open `index.html` in any modern browser **or**
3. Push to GitHub and enable **GitHub Pages** (Settings → Pages → Deploy from branch `main` / root).

```bash
git clone <your-repo-url>
cd tshwane-outage-system
# open index.html or serve with any static server
```

### Recommended first steps after opening

1. Go to **Analytics** → click **Load Demo Data**.
2. Visit **Dispatcher** to see prioritised queue and assign jobs.
3. Open **Technician**, select a technician, update status or simulate GPS move.
4. Report a new outage from the **Report Outage** page (click map to set location).

## File Structure

```
tshwane-outage-system/
├── index.html          # Dashboard + live map + process overview
├── report.html         # Customer outage reporting form + map
├── dispatcher.html     # Dispatcher console (queue, assign, map)
├── technician.html     # Technician mobile-style view + status updates
├── analytics.html      # Insights, charts, export / seed / clear
├── styles.css          # Professional municipal theme
├── app.js              # All business logic, localStorage, maps, charts
└── README.md
```

## Technical Notes

- **Maps**: Leaflet + OpenStreetMap (CDN)
- **Charts**: Chart.js (CDN)
- **Storage**: `localStorage` keys `tshwane_outages_v1` and `tshwane_techs_v1`
- **No backend**: Fully client-side. Perfect for demos, prototypes and GitHub Pages.
- **Technicians**: 5 pre-seeded profiles around Pretoria / Tshwane. Can be reset via “Load Demo Data”.

## Browser Support

Chrome, Firefox, Edge, Safari (recent versions). Requires JavaScript enabled.

## Licence

Demo / educational use for the City of Tshwane challenge. Adapt freely.
