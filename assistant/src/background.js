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
        // chrome.storage.local.get("assistantAppTabIdList", result => {
        //     if (data.tabId == result["assistantAppTabIdList"]) {
        //         if (data.url.includes("/apijson/")) {
        //             console.log("update tabs--------------")
        //             // chrome.tabs.update(Number(result["assistantAppTabIdList"]), {
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
        chrome.storage.local.get("assistantAppTabIdList", result => {
            const assistantAppTabIdList = result["assistantAppTabIdList"];
            if (assistantAppTabIdList && assistantAppTabIdList.length > 0) {
                if (assistantAppTabIdList.includes(data.tabId)) {
                    if (data.url.includes("chrome-extension") && data.type == chrome.webRequest.ResourceType.MAIN_FRAME) {
                        chrome.tabs.update(Number(data.tabId), {
                            url: data.initiator + "/index.html"
                        }, (tab) => {
                        });
                    }
                }
            }
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
    chrome.storage.local.get("assistantMenusIdCreatedStatus", result => {
        const assistantMenusIdCreatedStatus = result['assistantMenusIdCreatedStatus'];
        if(!assistantMenusIdCreatedStatus || assistantMenusIdCreatedStatus == 0) {
            chrome.contextMenus.create({
                id: "assistant_menus_id",
                title: 'Trans', // %s表示选中的文字
                contexts: ['page'], // 只有当选中文字时才会出现此右键菜单
                documentUrlPatterns: ["http://*/*", "https://*/*", "file://*"]
            });
            chrome.storage.local.set({"assistantMenusIdCreatedStatus": 1}, ()=> {
                console.log("assistant_menus_id has been created.");
            });
        }
    });

}

if(chrome && chrome.tabs) {

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        chrome.storage.local.get("assistantAppTabIdList", (result) => {
            if (result) {
                const assistantAppTabIdList = result["assistantAppTabIdList"];
                if (assistantAppTabIdList.length == 1 && assistantAppTabIdList[0] == tabId) {
                    clearAllAuthorize();
                }
                if (assistantAppTabIdList.length >= 0 && assistantAppTabIdList.includes(tabId)) {
                    const results = assistantAppTabIdList.filter((id) => Number(id) !== Number(tabId));
                    chrome.storage.local.set({ "assistantAppTabIdList": results }, function () {
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
        if (event.menuItemId == "assistant_menus_id") {
            chrome.windows.create({
                url: chrome.runtime.getURL('index.html'),
                type: "panel"
                // width: panelWidth,
                // height: panelHeight,
                // left: panelLeft,
                // top: panelTop
            });
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
