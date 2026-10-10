/**
 * @name QuestBackgroundVideo
 * @author M0_kii
 * @version 1.0.1
 * @description Keeps enrolled quest trailers playing when you switch windows.
 */

module.exports = class QuestBackgroundVideo {
    start() {
        this.stop();
        this.api = new BdApi("QuestBackgroundVideo");
        this.running = true;
        this.videos = new Set();
        this.startedVideos = new WeakSet();
        this.restorers = [];
        this.lastInput = -Infinity;
        this.realHasFocus = document.hasFocus.bind(document);
        // Discord's native main window defaults to numeric ID 0.
        this.mainWindowId = 0;
        this.enabled = this.api.Data.load("enabled") !== false;

        try {
            this.findStores();
            this.override(document, "hasFocus", {value: () => this.isProtected() || this.realHasFocus()});
            for (const [key, value] of [["hidden", false], ["visibilityState", "visible"]]) {
                const original = this.findDescriptor(document, key);
                if (!original?.get) continue;
                this.override(document, key, {
                    get: () => this.isProtected() ? value : original.get.call(document)
                });
            }

            // Guard the actual media operation too: some builds pause directly on blur.
            this.api.Patcher.instead(HTMLMediaElement.prototype, "pause", (media, args, original) => {
                const recentInput = Date.now() - this.lastInput < 1000;
                if (this.shouldProtect(media) && !media.paused && !this.realHasFocus() && !recentInput) return;
                return original(...args);
            });

            this.onMedia = () => this.refresh();
            this.onInput = event => {
                if (event.isTrusted) this.lastInput = Date.now();
            };
            for (const type of ["play", "pause", "ended", "emptied", "loadedmetadata"]) {
                document.addEventListener(type, this.onMedia, true);
            }
            for (const type of ["pointerdown", "keydown"]) {
                document.addEventListener(type, this.onInput, true);
            }

            this.refresh();
            // Discord can load these stores only after opening Quests.
            if (!this.windowStore || !this.questsStore) {
                this.retryTimer = setInterval(() => {
                    this.findStores();
                    this.refresh();
                    if (this.windowStore && this.questsStore) {
                        clearInterval(this.retryTimer);
                        this.retryTimer = null;
                    }
                }, 2000);
            }
        }
        catch (error) {
            this.stop();
            this.api.Logger.error("Unable to enable background quest video playback", error);
            BdApi.UI.showToast("QuestBackgroundVideo could not start. See the console for details.", {type: "error"});
        }
    }

    findStores() {
        if (!this.windowStore) {
            const store = BdApi.Webpack.getStore("WindowStore");
            if (store) {
                this.readFocusedWindowId = typeof store.getFocusedWindowId === "function"
                    ? store.getFocusedWindowId.bind(store) : null;
                this.captureWindowId();
                for (const method of ["isFocused", "isAppFocused", "isVisible"]) {
                    if (typeof store[method] !== "function") continue;
                    this.api.Patcher.after(store, method, (_self, args, result) => {
                        // Do not change focus for Discord's separate popout windows.
                        if (args[0] != null && String(args[0]) !== String(this.mainWindowId)) return result;
                        return this.isProtected() ? true : result;
                    });
                }
                if (this.readFocusedWindowId) {
                    this.api.Patcher.after(store, "getFocusedWindowId", (_self, _args, result) => {
                        return this.isProtected() ? this.mainWindowId : result;
                    });
                }
                this.windowStore = store;
            }
        }
        if (!this.questsStore) {
            const store = BdApi.Webpack.getStore("QuestsStore");
            if (store) {
                this.questsStore = store;
                this.onQuestsChange = () => this.refresh();
                store.addChangeListener?.(this.onQuestsChange);
            }
        }
    }

    captureWindowId() {
        // Capture the actual store ID only while this document really has focus.
        // Keep the unpatched getter so switching to a popout cannot change it.
        if (!this.realHasFocus()) return;
        const id = this.readFocusedWindowId?.();
        if (id != null) this.mainWindowId = id;
    }

    activeQuests() {
        const collection = this.questsStore?.quests;
        const quests = collection instanceof Map ? [...collection.values()]
            : Array.isArray(collection) ? collection : Object.values(collection ?? {});
        return quests.filter(quest => {
            const status = quest?.userStatus;
            const config = quest?.config;
            const tasks = (config?.taskConfigV2 ?? config?.taskConfig)?.tasks;
            const expiry = Date.parse(config?.expiresAt);
            return status?.enrolledAt && !status.completedAt && !status.claimedAt
                && (!Number.isFinite(expiry) || expiry > Date.now())
                && (tasks?.WATCH_VIDEO || tasks?.WATCH_VIDEO_ON_MOBILE);
        });
    }

    questForVideo(video, quests) {
        // CDN quest asset URLs often contain /quests/<quest id>/.
        for (const source of [video.currentSrc, video.src, ...Array.from(video.querySelectorAll("source"), node => node.src)]) {
            if (!source) continue;
            try {
                const parts = new URL(source, location.href).pathname.split("/");
                const index = parts.indexOf("quests");
                if (index >= 0) {
                    const quest = quests.find(item => String(item.id) === parts[index + 1]);
                    if (quest) return quest;
                }
            }
            catch { /* Ignore blob URLs and missing sources; inspect React below. */ }
        }

        // A structural quest prop also identifies blob-backed/localized players.
        let fiber = BdApi.ReactUtils.getInternalInstance(video);
        for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
            const props = fiber.memoizedProps;
            if (!props || typeof props !== "object") continue;
            const id = props.quest?.id ?? props.questId ?? props.quest_id;
            if (id == null) continue;
            const quest = quests.find(item => String(item.id) === String(id));
            if (quest) return quest;
        }
        return null;
    }

    refresh() {
        if (!this.running) return;
        try {
            this.captureWindowId();
            const quests = this.activeQuests();
            this.questIds = new Set(quests.map(quest => String(quest.id)));
            const videos = new Set();
            this.videoQuests = new Map();
            if (this.enabled && quests.length) {
                for (const video of document.querySelectorAll("video")) {
                    const quest = this.questForVideo(video, quests);
                    if (!quest) continue;
                    videos.add(video);
                    this.videoQuests.set(video, String(quest.id));
                    if (!video.paused && !video.ended) this.startedVideos.add(video);
                }
            }
            this.videos = videos;
            this.notifyFocusChange();
        }
        catch (error) {
            this.videos.clear();
            if (!this.reportedDetectionError) {
                this.reportedDetectionError = true;
                this.api.Logger.warn("Quest player detection failed", error);
            }
        }
    }

    shouldProtect(video) {
        return Boolean(this.running && this.enabled && this.videos?.has(video)
            && this.startedVideos?.has(video) && video.isConnected && !video.ended
            && this.questIds?.has(this.videoQuests?.get(video)));
    }

    isProtected() {
        return Boolean(this.videos && [...this.videos].some(video => this.shouldProtect(video)));
    }

    notifyFocusChange() {
        const protectedNow = this.isProtected();
        if (protectedNow === this.wasProtected) return;
        this.wasProtected = protectedNow;
        // Notify React focus subscribers outside the quest store's dispatch.
        if (this.focusNotificationPending) return;
        this.focusNotificationPending = true;
        queueMicrotask(() => {
            this.focusNotificationPending = false;
            if (this.running) this.windowStore?.emitChange?.();
        });
    }

    observer() {
        this.refresh();
    }

    findDescriptor(object, key) {
        for (let current = object; current; current = Object.getPrototypeOf(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor) return descriptor;
        }
    }

    override(object, key, descriptor) {
        const previous = Object.getOwnPropertyDescriptor(object, key);
        Object.defineProperty(object, key, {configurable: true, ...descriptor});
        this.restorers.push(() => {
            const current = Object.getOwnPropertyDescriptor(object, key);
            if (current?.get !== descriptor.get || current?.value !== descriptor.value) return;
            if (previous) Object.defineProperty(object, key, previous);
            else delete object[key];
        });
    }

    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.style.cssText = "padding:16px;color:var(--text-normal);line-height:1.6";
        const label = document.createElement("label");
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = this.enabled !== false;
        toggle.style.marginRight = "8px";
        toggle.addEventListener("change", () => {
            this.enabled = toggle.checked;
            this.api.Data.save("enabled", this.enabled);
            this.refresh();
        });
        label.append(toggle, "Keep quest trailers playing when switching windows");
        const help = document.createElement("p");
        help.textContent = "Accept a video quest and press Play. Keep its player open while using another window. Pause and closing the player still work.";
        const status = document.createElement("p");
        const updateStatus = () => {
            status.textContent = !this.running ? "Plugin is disabled."
                : !this.enabled ? "Background playback is off."
                : this.isProtected() ? "Quest trailer detected. Background playback is active."
                : !this.questsStore ? "Open Quests so Discord can load its quest data."
                : "Waiting for an enrolled quest trailer to play.";
        };
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Refresh status";
        button.addEventListener("click", () => { this.refresh(); updateStatus(); });
        updateStatus();
        panel.append(label, help, status, button);
        return panel;
    }

    stop() {
        const wasRunning = this.running;
        this.running = false;
        clearInterval(this.retryTimer);
        this.retryTimer = null;
        if (this.onMedia) {
            for (const type of ["play", "pause", "ended", "emptied", "loadedmetadata"]) {
                document.removeEventListener(type, this.onMedia, true);
            }
        }
        if (this.onInput) {
            for (const type of ["pointerdown", "keydown"]) {
                document.removeEventListener(type, this.onInput, true);
            }
        }
        this.questsStore?.removeChangeListener?.(this.onQuestsChange);
        this.api?.Patcher.unpatchAll();
        for (const restore of (this.restorers ?? []).reverse()) restore();
        this.restorers = [];
        this.videos?.clear();
        if (wasRunning) this.windowStore?.emitChange?.();
        this.windowStore = null;
        this.readFocusedWindowId = null;
        this.questsStore = null;
        this.wasProtected = false;
    }
};
