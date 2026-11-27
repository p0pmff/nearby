import {build} from "esbuild";
import {cpSync,mkdirSync} from "node:fs";
mkdirSync("www/vendor",{recursive:true});
cpSync("node_modules/leaflet/dist/leaflet.css","www/vendor/leaflet.css");
cpSync("node_modules/leaflet/dist/images","www/vendor/images",{recursive:true});
cpSync("src/style.css","www/app.css");
await build({entryPoints:{app:"src/main.js",owner:"src/owner.js"},bundle:true,minify:true,format:"esm",target:"es2020",outdir:"www"});
