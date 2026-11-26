if(chrome && chrome.webRequest) {
    chrome.webRequest.onBeforeSendHeaders.addListener(data => {

    }, { urls: ["<all_urls>"] }, ["requestHeaders"]);

    chrome.webRequest.onHeadersReceived.addListener(data => {
        let setMyCookie = {
            name: "Set-Cookie",
            value: "my-cookie1=my-cookie-value1"
        };
        data.responseHeaders.push(setMyCookie);
        return { responseHeaders: data.responseHeaders };
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]);



    chrome.webRequest.onBeforeRequest.addListener(data => {
        // chrome.storage.local.get("cloverAppTabIdList", result => {
        //     if (data.tabId == result["cloverAppTabIdList"]) {
        //         if (data.url.includes("/apijson/")) {
        //             console.log("update tabs--------------")
        //             // chrome.tabs.update(Number(result["cloverAppTabIdList"]), {
        //             //     url: data.initiator + "/index.html"
        //             // });
        //         }

        //         chrome.windows.getCurrent(val=> {

        //         })
        //     }
        // });
        // if (data.requestBody && data.requestBody.raw) {
        //     const content = data.requestBody.raw[0].bytes;

        //     const view = new DataView(content);
        //     let arr = [];
        //     for (let index = 0; index < content.byteLength; index++) {
        //         const element = view.getInt8(index);
        //         arr.push(element)

        //     }
        //     const result = String.fromCharCode(...arr);

        //     var request = window.indexedDB.open("MyTestDatabase");

        //     request.onerror = function (event) {
        //         alert("Why didn't you allow my web app to use IndexedDB?!");
        //     }

        //     request.onsuccess = function (event) {
        //         db = event.target.result;
        //         var customerObjectStore = db.transaction(["requestBodyItems"], "readwrite")
        //             .objectStore("requestBodyItems");
        //         customerObjectStore.add(JSON.parse(result))
        //     }

        //     request.onupgradeneeded = function (event) {
        //         db = event.target.result;
        //         const objectStore = db.createObjectStore("requestBodyItems", { keyPath: "name" });
        //         objectStore.transaction.oncomplete = function (event) {
        //             var customerObjectStore = db.transaction(["requestBodyItems"], "readwrite")
        //                 .objectStore("requestBodyItems");
        //             customerObjectStore.add(JSON.parse(result))

        //         }
        //     }
        //     console.log(result)
        // }

        const val = JSON.stringify({"name": "123", "value": "78e"});

        // Extension pages are static files, so any path other than index.html (for
        // example the extension root "/") fails to load. Re-enter through index.html.
        // Only real main-frame requests are handled here: router pushState /
        // replaceState never reaches webRequest, so in-app navigation is untouched.
        if (data.type == chrome.webRequest.ResourceType.MAIN_FRAME && claimEntryFallback(data.tabId, data.url)) {
            chrome.tabs.update(data.tabId, {
                url: buildAppUrl()
            }, () => {
                void chrome.runtime.lastError;
            });
            return;
        }

        if (data.url && (data.url.includes(":4200") || data.url.includes(":28001") || data.url.includes(":8980"))) {
            // const ipAndPort = data.initiator.replace(/https:\/\/|http:\/\//, "");
            let basePath = extractBasePath(data.url);

            chrome.storage.local.get("ipAndPort", (result) => {
                const serverList = result["ipAndPort"];
                if (serverList && serverList.length > 0) {
                    if (!serverList.includes(basePath)) {
                        serverList.push(basePath);
                        chrome.storage.local.set({ ipAndPort: serverList }, function () {
                            // let us know it worked
                            console.log("V3 Test: initialized test click counter to 0");
                        });
                    }
                } else {
                    chrome.storage.local.set({ ipAndPort: [basePath] }, function () {
                        // let us know it worked
                        console.log("V3 Test: initialized test click counter to 0");
                    });
                }
            });
        }
    }, { urls: ["<all_urls>"] }, ["requestBody"]);

    chrome.webRequest.onErrorOccurred.addListener(data => {
        if (data.type != chrome.webRequest.ResourceType.MAIN_FRAME) {
            return;
        }
        if (!data.url || !data.url.startsWith(chrome.runtime.getURL(""))) {
            return;
        }
        if (typeof data.tabId != "number" || data.tabId < 0) {
            return;
        }
        chrome.storage.local.get("cloverAppTabIdList", result => {
            const cloverAppTabIdList = result["cloverAppTabIdList"] || [];
            if (!cloverAppTabIdList.includes(data.tabId)) {
                return;
            }
            if (!claimEntryFallback(data.tabId, data.url)) {
                return;
            }
            // Extension pages are static files, so a path such as
            // chrome-extension://<id>/clover/123 fails to load. Re-enter through the
            // real index.html; the panel does not restore routed urls.
            chrome.tabs.update(Number(data.tabId), {
                url: buildAppUrl()
            }, () => {
                void chrome.runtime.lastError;
            });
        });

    }, { urls: ["<all_urls>"] });
}

if(chrome && chrome.storage) {
    chrome.storage.onChanged.addListener((data) => {
    })


    // const panelWidth = screen.availWidth * 0.8;
    // const panelHeight = screen.availHeight * 0.8;

    // const panelLeft = (screen.availWidth - panelWidth) * 0.5;
    // const panelTop = (screen.availHeight - panelHeight) * 0.5;
    chrome.storage.local.get("cloverMenusIdCreatedStatus", result => {
        const cloverMenusIdCreatedStatus = result['cloverMenusIdCreatedStatus'];
        if(!cloverMenusIdCreatedStatus || cloverMenusIdCreatedStatus == 0) {
            chrome.contextMenus.create({
                id: "clover_menus_id",
                title: 'Clover', // %s表示选中的文字
                contexts: ['page'], // 只有当选中文字时才会出现此右键菜单
                documentUrlPatterns: ["http://*/*", "https://*/*", "file://*"]
            });
            chrome.storage.local.set({"cloverMenusIdCreatedStatus": 1}, ()=> {
                console.log("clover_menus_id has been created.");
            });
        }
    });

}

if(chrome && chrome.tabs) {

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        recentFallbacks.delete(tabId);
        chrome.storage.local.get("cloverAppTabIdList", (result) => {
            if (result) {
                const cloverAppTabIdList = result["cloverAppTabIdList"] || [];
                if (cloverAppTabIdList.length == 1 && cloverAppTabIdList[0] == tabId) {
                    clearAllAuthorize();
                }
                if (cloverAppTabIdList.length > 0 && cloverAppTabIdList.includes(tabId)) {
                    const results = cloverAppTabIdList.filter((id) => Number(id) !== Number(tabId));
                    chrome.storage.local.set({ "cloverAppTabIdList": results }, function () {
                        // let us know it worked
                        console.log("V3 Test: initialized test click counter to 0");
                    });
                }
            }
        });
    });

}

if(chrome && chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(event => {
        if (event.menuItemId == "clover_menus_id") {
            // Every click opens its own window on purpose: multiple panels are allowed.
            openAppWindow().catch(err => console.error("Failed to open Clover window:", err));
        }
    });

    // chrome.contextMenus.create({
    //     id: "quick_visit1",
    //     title: '快速访问1', // %s表示选中的文字
    //     contexts: ['page'], // 只有当选中文字时才会出现此右键菜单
    //     documentUrlPatterns: ["http://*/*", "https://*/*", "file://*"]
    // });

    // chrome.contextMenus.onClicked.addListener(event => {
    //     if (event.menuItemId == "quick_visit1") {
    //         chrome.windows.create({
    //             url: 'index.html',
    //             type: "panel"
    //             // width: panelWidth,
    //             // height: panelHeight,
    //             // left: panelLeft,
    //             // top: panelTop
    //         });
    //     }
    // });

}

if(this) {
    /**
     * 此处注册fetch事件能够起到这样的作用：
     * 当serviceWorker在停止状态（Running Status: STOPPED）时，
     * 一个fetch事件产生后， serviceWorker能够重新启动起来，变为运行中状态（Running Status: RUNNING）
     * 
     */
    this.addEventListener('fetch', function (event) {
    });
}

async function clearAllAuthorize() {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    if (rules && rules.length > 0) {
        let removeRuleIds = [];
        for (let index = 0; index < rules.length; index++) {
            const rule = rules[index];
            const requestHeaders = rule.action.requestHeaders;
            const zAccesstoken = requestHeaders.filter((val) => val.header == "Z-ACCESS-TOKEN");
            if (zAccesstoken.length > 0) {
                removeRuleIds.push(rule.id);

            }
        }

        if (removeRuleIds.length > 0) {
            const removeRuleOptions = {
                removeRuleIds: removeRuleIds
            };
            const updateResult = await chrome.declarativeNetRequest.updateDynamicRules(removeRuleOptions);
        }
    }
}


function extractBasePath(url) {
    let scheme = '';
    let rs = '';
    if (url.startsWith("http://")) {
        scheme = "http://";
        rs = url.replace("http://", "");
    } else if (url.startsWith("https://")) {
        scheme = "https://";
        rs = url.replace("https://", "");
    } else if (url.startsWith("chrome-extension://")) {
        scheme = "chrome-extension://";
        rs = url.replace("chrome-extension://", "");
    }
    const firstSlashIndex = rs.indexOf("/");
    const ipAndPortResult = scheme + rs.substring(0, firstSlashIndex);
    return ipAndPortResult;
}

const APP_ENTRY = "index.html";

// Extension paths that were redirected a moment ago, keyed by tab id. Prevents a
// tab from bouncing between an invalid path and index.html forever when the app
// (or the browser) keeps re-requesting the same failing address.
const FALLBACK_WINDOW_MS = 5000;
const recentFallbacks = new Map();

/**
 * App entry url, chrome-extension://<id>/index.html. The panel is a single page and
 * does not use routed urls, so every other extension path is treated as invalid.
 *
 * @returns {string}
 */
function buildAppUrl() {
    return chrome.runtime.getURL(APP_ENTRY);
}

/**
 * True when `url` points into this extension but is neither the entry document nor
 * a real static file (for example the extension root "/" or "/clover/123").
 * Claims the url per tab so the same failing address is only retried once per
 * FALLBACK_WINDOW_MS, which prevents redirect loops.
 *
 * @param {number} tabId
 * @param {string} url
 * @returns {boolean}
 */
function claimEntryFallback(tabId, url) {
    if (!url || typeof tabId != "number" || tabId < 0) {
        return false;
    }
    // Only own extension pages may be rewritten. Without this check every main
    // frame request (http://localhost:4200/, https://example.com/...) would be
    // treated as an app path and the tab would jump into the extension.
    if (!url.startsWith(chrome.runtime.getURL(""))) {
        return false;
    }
    try {
        const parsed = new URL(url);
        if (parsed.pathname == new URL(chrome.runtime.getURL(APP_ENTRY)).pathname) {
            return false;
        }
        // Real files such as assets/*.js, chunk-*.js or favicon.svg need no fallback.
        const lastSegment = parsed.pathname.substring(parsed.pathname.lastIndexOf("/") + 1);
        if (/\.[a-z0-9]{1,5}$/i.test(lastSegment)) {
            return false;
        }
    } catch (err) {
        return false;
    }
    const now = Date.now();
    const last = recentFallbacks.get(tabId);
    if (last && last.url == url && now - last.at < FALLBACK_WINDOW_MS) {
        return false;
    }
    recentFallbacks.set(tabId, { url: url, at: now });
    return true;
}

/**
 * Opens a new app window. Each call creates its own window on purpose:
 * multiple panels are allowed to stay open side by side.
 */
async function openAppWindow() {
    const result = await chrome.storage.local.get("windowRect");
    const windowRect = result["windowRect"] || { x: 100, y: 100, width: 1200, height: 800 };
    const url = buildAppUrl();
    try {
        return await chrome.windows.create({
            url: url,
            type: "panel",
            width: windowRect.width,
            height: windowRect.height,
            left: windowRect.x,
            top: windowRect.y
        });
    } catch (err) {
        // The saved rect may come from a monitor that is no longer attached; Chrome
        // rejects bounds that are not visible enough. Retry without a position.
        console.warn("Failed to open Clover window with the saved rect, retrying:", err);
        return chrome.windows.create({
            url: url,
            type: "panel",
            width: windowRect.width,
            height: windowRect.height
        });
    }
}
