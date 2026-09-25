'use strict';

// Electron supplies window.dumbPark from its isolated preload. The web build
// replaces this file with the browser adapter bundle.
if (!window.dumbPark) throw new Error('DumbPark browser adapter was not built.');
