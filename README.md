# QuestBackgroundVideo

A standalone BetterDiscord plugin that keeps an enrolled quest trailer playing when you switch to another window.

## Install

1. Open Discord **User Settings → BetterDiscord → Plugins → Open Plugins Folder**.
2. Copy `QuestBackgroundVideo.plugin.js` into that folder.
3. Enable **QuestBackgroundVideo** in the plugin list.
4. Accept a video quest, open its trailer, and press **Play**. Keep the player open, then switch windows.

No dependency plugins, build step, or package installation are needed. Disable the plugin to restore the original focus and media behavior.

## Behavior

The plugin identifies video players using a quest asset URL or a React quest property matched to Discord's enrolled, incomplete video quests. Background protection starts only after playback has started and ends when the video ends, the quest completes, or the player is removed. Clicking Pause and closing the player still work. It never starts videos itself, advances the playback position, accepts quests, or claims rewards.

While a detected trailer is open after playback starts, Discord's main window focus and document visibility checks report that it is active. This can also affect other features that read those checks during that time. Other audio/video elements retain their normal pause behavior.

## Troubleshooting and verification

Open the plugin's settings and choose **Refresh status** to see whether it detected a trailer. If it is waiting, accept the quest and press Play with the player open. If detection still fails, Discord may have changed its internal player data.

Version 1.0.1 fixes focus queries that pass Discord's numeric window ID and aligns the focused-window ID with the protected player. After replacing an older plugin file, toggle the plugin off/on, then close and reopen the trailer to clear any existing away overlay. If an away message still appears while the video plays, check the quest progress counter: the overlay alone does not establish whether progress stopped. Playback and increasing quest progress with an away overlay were reported for version 1.0.0; removal of the overlay in version 1.0.1 still needs a live check.

Syntax checks and 12 mocked lifecycle tests passed during development; the test harness is not included in this repository. Live Discord playback and server-side quest progress are **not verified** in this project; Discord updates or additional server checks may prevent progress from counting. Closing/minimizing Discord or putting the computer to sleep may suspend playback. Test by watching the progress counter before and after briefly switching to another window, then verify Pause, closing the player, and disabling the plugin.

Discord documents the default pause-on-switch behavior in its [Quests FAQ](https://support.discord.com/hc/en-us/articles/22225719947543-Discord-Quests-FAQ). API references: [BetterDiscord stores](https://docs.betterdiscord.app/discord/modules/data-stores), [Patcher](https://docs.betterdiscord.app/api/Patcher), and [ReactUtils](https://docs.betterdiscord.app/api/ReactUtils).

## Development

```powershell
node --check QuestBackgroundVideo.plugin.js
```

This checks JavaScript syntax. Verify playback and quest progress in Discord after making changes.
