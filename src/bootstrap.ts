import { registerSW } from "virtual:pwa-register";
import { AppController } from "./app-controller";
import "./styles.css";

const app = new AppController();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { app.showUpdateAvailable(); },
  onRegisterError(error) { console.error("Service Workerを登録できませんでした", error); }
});

app.setUpdateHandler(() => updateSW(true));
void app.start();
