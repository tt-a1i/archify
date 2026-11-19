package probe.app;

import probe.api.Api;

public class App {
    void run() {
        Api.staticCall();
        new Api().instanceCall();
        Api.create().instanceCall();
    }
}
