# Simple Card Spotlight Method (Based on Test 1)

## Overview
This is the **working method** from Test 1 that successfully highlights one card while dimming all others.

## How It Works

### 1. Use a Boolean State
```javascript
const [showSpotlight, setShowSpotlight] = useState(false);
```

### 2. Wrap Each Card in a `<div>` with Conditional Styles

#### For the TARGET CARD (to be highlighted):
```jsx
<div
  style={{
    transition: 'all 0.3s ease !important',
    transform: showSpotlight ? 'scale(1.15) !important' : 'scale(1) !important',
    zIndex: showSpotlight ? 1000 : 1,
    position: 'relative !important',
    boxShadow: showSpotlight ? '0 0 50px 10px rgba(0, 123, 255, 0.8) !important' : 'none !important',
    border: showSpotlight ? '4px solid #007bff !important' : 'none !important',
    borderRadius: '12px !important',
    backgroundColor: showSpotlight ? '#ffffff !important' : 'transparent !important',
    filter: showSpotlight ? 'brightness(1.2) !important' : 'none !important'
  }}
>
  <Card>
    {/* Card content */}
  </Card>
</div>
```

#### For ALL OTHER CARDS (to be dimmed):
```jsx
<div
  style={{
    transition: 'all 0.3s ease !important',
    opacity: showSpotlight ? '0.15 !important' : '1 !important',
    pointerEvents: showSpotlight ? 'none !important' : 'auto !important',
    filter: showSpotlight ? 'grayscale(100%) blur(4px) brightness(0.3) !important' : 'none !important',
    transform: showSpotlight ? 'scale(0.85) !important' : 'scale(1) !important'
  }}
>
  <Card>
    {/* Card content */}
  </Card>
</div>
```

### 3. Add Background Overlay
```jsx
{showSpotlight && (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 999,
    pointerEvents: 'none'
  }} />
)}
```

## Key Points

### ✅ What Makes It Work:
1. **Wrapper divs** - Don't style the Card components directly, wrap them in divs
2. **`!important`** - Forces styles to override Shopify Polaris defaults
3. **Conditional styles** - Uses ternary operators based on boolean state
4. **Dramatic differences** - 85% opacity difference, large scale changes, heavy blur
5. **Z-index layering** - Target card (1000) > Background overlay (999) > Other cards (1)

### ❌ What Doesn't Work:
- Trying to modify existing DOM elements after render
- Complex clip-path or portal systems
- Styling Card components directly
- Subtle visual differences

## Implementation Steps:
1. Add boolean state to track spotlight
2. Wrap target card in div with highlight styles
3. Wrap all other cards in divs with dimming styles
4. Add background overlay
5. Use conditional rendering based on state

## Visual Effects:
- **Target card**: 115% scale, blue glow, bright white, clickable
- **Other cards**: 15% opacity, grayscale blur, 85% scale, unclickable
- **Background**: Dark overlay covers everything behind cards