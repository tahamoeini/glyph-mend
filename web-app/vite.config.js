import {defineConfig} from 'vite'; import {VitePWA} from 'vite-plugin-pwa';
export default defineConfig({base:'./',plugins:[VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg'],manifest:false,workbox:{maximumFileSizeToCacheInBytes:8*1024*1024}})],test:{environment:'jsdom',include:['src/**/*.test.js']}});
