# BORJIE Design System

Spotify × Instagram × TikTok × WhatsApp inspired styling for mobile and web.

## Theme

- **Base**: Dark mode (#121212 background)
- **Accent**: Spotify green (#1DB954)
- **Cards**: #282828 surface, 8px rounded corners
- **Typography**: Clean, bold headings; gray body text

## Components

### Feed (Instagram-style)
- Vertical scroll feed
- Author avatar + name + time
- Image or text content
- Like, Comment, Share, Save actions
- `FeedCard` / `feed_card.dart`

### Stories (Instagram/TikTok/WhatsApp)
- Horizontal scroll bar
- Gradient ring for new status
- Circular avatars
- Ephemeral status updates
- `StoriesBar` / `stories_bar.dart`

### Profile (Instagram + TikTok)
- Bio and stats (following/followers)
- Grid layout for posts/content
- Highlights (pinned stories)
- `ProfileGrid` / profile grid layout

### Marketplace (TikTok Shop)
- Horizontal scroll vendor cards
- Image + name + category + price
- Public vendor listings
- `VendorCard` / `VendorCard.tsx`

### Messaging (WhatsApp)
- Chat bubbles (green sent, gray received)
- Group chat with sender name
- Clean typography, 18px rounded bubbles
- Reply threading
- `ChatBubble` / `chat_bubble.dart`

### Cards (Spotify)
- Dark card (#282828)
- Hover state (#2a2a2a)
- 8px border radius
- Icon + title + subtitle layout

## Colors

| Token | Hex | Use |
|-------|-----|-----|
| surface | #121212 | Background |
| surface-card | #282828 | Cards |
| spotify-green | #1DB954 | Primary, accents |
| muted | #B3B3B3 | Secondary text |

## Responsive

- Mobile-first
- Bottom nav on mobile
- Sidebar on web (optional)
- Touch targets min 44px
