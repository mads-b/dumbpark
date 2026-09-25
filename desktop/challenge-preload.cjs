'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    handleToken: { postMessage: token => ipcRenderer.send('challenge-token', token) },
    handleError: { postMessage: message => ipcRenderer.send('challenge-error', message) }
  }
});
