# Patches

Upstream: https://github.com/Samuels-Development/sd-zonecreator (main)

Fork of sd-zonecreator for the core of Heritage-RP/PRODUCTION-SERVER. Every patch is generic: a server sets its own
values through convars or other resources (Heritage-RP/PRODUCTION-SERVER docs/dev/forks.md).

| Patch | Kind | Upstream | Files |
|---|---|---|---|
| Edit session: export `editZone(session)` opens the creator on zones given by another resource, Confirm sends the edited zone back (`sd-zonecreator:editSessionResult`); export `cancelEdit(sessionId)` | generic | candidate | `client.lua`, `web/src/App.tsx`, `web/src/components/ZoneCreator.tsx`, `web/src/components/ZoneCreator.css` |
| Pick session: export `pickPoint(session)` shows the caller's markers on the satellite map, a marker or a point comes back (`sd-zonecreator:pickSessionResult`, PRODUCTION-SERVER#392) | generic | candidate | `client.lua`, `web/src/App.tsx`, `web/src/components/PointPicker.tsx`, `web/src/components/PointPicker.css`, `web/src/components/mapCoords.ts` |
| Session labels in ox_lib's locale (`ox:locale`, English by default) | generic | candidate | `fxmanifest.lua`, `client.lua`, `locales/*.json`, `web/src/components/sessionLabels.ts` |
| The player is put back (visible, unfrozen, with collision, at their position) when the resource stops during the zone viewer or a ground Z lookup | generic | candidate | `client.lua` |
| Logs through `lib.print` (HrpLog when hrp-metrics runs) | generic | candidate | `client.lua` |
| Web build with pnpm (Devtools builds `web/` on update) | generic | no | `web/pnpm-lock.yaml` |
| Tests: `tests/run.sh` runs `tests/lua/*_spec.lua` in Lua 5.4 through docker (`just test`) | generic | no | `tests/**` |
| Documentation of the fork | generic | no | `README.md`, `PATCHES.md` |
