# Plan: Forum-Based Game Logging System (Revised)

This document outlines the plan to modify the existing game logging system to use a Discord forum channel with threads for different player counts.

### 1. Environment Configuration

To make the system flexible, we'll use environment variables to store the thread IDs for each player count range. This will allow you to easily change the threads without modifying the code.

*   `FORUM_WEBHOOK_URL`: The webhook URL for the forum channel.
*   `THREAD_ID_VERY_LOW`: For 1 player games.
*   `THREAD_ID_LOW`: For 2-5 players.
*   `THREAD_ID_MEDIUM`: For 6-50 players.
*   `THREAD_ID_HIGH`: For 51-500 players.
*   `THREAD_ID_ENVIOUS`: For games with more than 500 players.

### 2. Core Logic Modifications

The core logic in `api/index.js` will be modified to handle the new forum-based logging system. Here's a breakdown of the changes:

*   **Get Thread ID by Player Count:** A new function will be created that takes the player count as input and returns the appropriate thread ID based on the new ranges.
*   **Dynamic Webhook URL:** The webhook URL will be dynamically constructed for posting and editing messages by appending `?thread_id=<thread_id>` to the `FORUM_WEBHOOK_URL`.
*   **Message Management:**
    *   When a game is first posted, it will be sent to the correct thread based on its player count. The `messageId` and the `threadId` will be stored in Redis.
    *   When a game's player count changes, the system will check if it needs to be moved to a different thread.
    *   If a move is required, the old message will be deleted from the previous thread, and a new message will be posted to the correct thread. The `messageId` and `threadId` in Redis will be updated accordingly.
    *   If the player count changes but the game remains in the same thread, the existing message will simply be edited.

### 3. Redis Data Structure

The data structure in Redis will be updated to store not only the `messageId` but also the `threadId` for each game. This will allow us to track which thread each game is currently in.

The new data structure will look like this:

```json
{
  "messageId": "123456789012345678",
  "threadId": "098765432109876543",
  "timestamp": 1678886400,
  "placeId": "123456789"
}
```

### 4. Stale Game Cleaner

The `cleanupStaleGames` function in `api/lib/core-logic.js` will be adapted. It will iterate through all `game:*` keys in Redis. If a game is stale, it will use the `FORUM_WEBHOOK_URL` and the stored `messageId` to delete the message from the forum.

### 5. A Note on Tags

This plan assumes that you have already created the forum threads and assigned the desired tags (e.g., "Low player games") to them within Discord. The bot will not manage tags; it will only post messages to the threads you've set up. The messages will automatically appear under the tags associated with their respective threads.

### 6. Architectural Diagram

Here's a Mermaid diagram illustrating the new workflow:

```mermaid
graph TD
    A[Roblox Server Request] --> B{Get Player Count};
    B --> C{Determine Thread ID};
    C --> D{Game in Redis?};
    D -- Yes --> E{Player Count Changed?};
    D -- No --> F[Post to Correct Thread];
    E -- Yes --> G{Thread Changed?};
    E -- No --> H[Edit Message in Same Thread];
    G -- Yes --> I[Delete Old Message];
    G -- No --> H;
    I --> F;
    F --> J[Store messageId & threadId in Redis];
    H --> J;