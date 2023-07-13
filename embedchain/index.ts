import { EmbedChainApp } from './embedchain';

export { EmbedChainApp };

export const App = async () => {
  const app = new EmbedChainApp();
  await app.initApp;
  return app;
};
