---
'ng-health': minor
---

New check `dependencies/peer-conflicts`: reports direct dependencies whose peer dependencies are missing or outside the required range, which is the cause of npm `ERESOLVE` errors and installs forced with `--legacy-peer-deps`. Peers are resolved from `node_modules` the way Node does (npm, yarn and pnpm layouts), and when online the fix names the newest compatible version, e.g. `npm install ngx-echarts@20.0.2` for an Angular 20 app.
