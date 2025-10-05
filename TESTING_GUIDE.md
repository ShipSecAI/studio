# 🧪 Testing Guide - Security Workflow Builder

**Dev Server:** http://localhost:5173/

The application is now running! Follow this guide to test all the features we built.

---

## ✅ Quick Test Checklist

### 1. Component Palette (Sidebar) ✓
- [x] Sidebar shows 3 components grouped by type
- [x] Components display icons and descriptions
- [x] "ShipSecAI" badges visible on official components
- [x] Component count shows at bottom (3 components available)

**What to look for:**
- **Security Tools** section with Subfinder
- **Input** section with File Loader
- **Processing** section with Merge

---

### 2. Drag & Drop Components ✓
**Test Steps:**
1. Drag "File Loader" from sidebar onto canvas
2. Drag "Subfinder" onto canvas
3. Drag "Merge" onto canvas

**Expected Result:**
- Nodes appear where you drop them
- Each node shows:
  - Component icon (FileUp, Network, Merge)
  - Component name
  - Input ports (left side, blue dots)
  - Output ports (right side, green dots)
  - Version number in footer
  - Official badge

---

### 3. Node Display ✓
**Check each node shows:**

**File Loader:**
- No input ports (it's an input component)
- 1 output port: "File Contents" →

**Subfinder:**
- 1 input port: ← "Target Domain" (with *required indicator)
- 1 output port: "Discovered Subdomains" →

**Merge:**
- 3 input ports: ← "Input 1" (required), "Input 2", "Input 3"
- 1 output port: "Merged Output" →

---

### 4. Connect Nodes ✓
**Test Steps:**
1. Drag from File Loader's "File Contents" output (green dot)
2. Connect to Subfinder's "Target Domain" input (blue dot)
3. Drag from Subfinder's "Discovered Subdomains" output
4. Connect to Merge's "Input 1"

**Expected Result:**
- Smooth curved lines connect the nodes
- Connection appears animated

**Try Invalid Connection:**
- Try connecting Subfinder output to File Loader (should fail - File Loader has no inputs)
- You should see an alert: "Invalid connection ports" or similar

---

### 5. Configure Node Parameters ✓
**Test Steps:**
1. Click on the Subfinder node
2. Config panel appears on the right side

**Check Config Panel shows:**
- Component info with icon and badges at top
- **Inputs section:**
  - "Target Domain" showing "⚠ Not connected" (or "✓ Connected from file-loader-...")
- **Parameters section:**
  - "Data Sources" - multi-select checkboxes (should default to "All Sources")
  - "Timeout (seconds)" - number input (default: 30)
  - "Recursive Enumeration" - checkbox (default: unchecked)
- **Documentation section:**
  - Shows Subfinder description

**Interact with Parameters:**
1. Change timeout to 60 - value should persist
2. Check "Recursive Enumeration" - should toggle
3. Select multiple data sources - badges appear below
4. Click X or click canvas background - panel closes

---

### 6. Test All Parameter Types ✓

**File Loader Parameters:**
- "File Upload" - file input field
- "Parse As" - dropdown select (Auto-detect, Plain Text, JSON, CSV)

**Subfinder Parameters:**
- "Data Sources" - multi-select with badges ✓
- "Timeout" - number input with min/max ✓
- "Recursive" - boolean checkbox ✓

**Merge Parameters:**
- "Deduplicate By" - select dropdown ✓
- "Field Name" - text input ✓

---

### 7. Run Workflow Execution ✓
**Test Steps:**
1. Make sure you have at least 2-3 nodes on canvas
2. Click the **Run** button in top bar
3. Watch the magic! ✨

**Expected Behavior:**
1. **Bottom panel auto-expands** showing "Logs" tab
2. **Run button changes** to red "Stop" button
3. **Nodes animate sequentially:**
   - First node: border turns amber, shows spinner
   - After 1-3 seconds: turns green, shows checkmark ✓
   - Next node starts executing
   - Process continues through all nodes
4. **Logs stream in real-time:**
   - Timestamp | INFO | [node-id] | "Starting execution..."
   - Color-coded logs (blue=info, yellow=warn, red=error)
   - Auto-scrolls to bottom
5. **Top bar shows status:**
   - "✓ Completed" in green (90% success rate)
   - OR "✗ Failed" in red (10% chance)
6. **Logs count badge** appears on Logs tab

**Note:** This uses mock execution - nodes execute sequentially with 1-3 second delays each.

---

### 8. Stop Execution ✓
**Test Steps:**
1. Click Run button
2. While execution is running, click the red **Stop** button

**Expected Result:**
- Execution stops immediately
- Logs stop streaming
- Run button reappears

---

### 9. Clear Logs ✓
**Test Steps:**
1. After an execution, logs are visible in bottom panel
2. Click the **Clear** button next to the panel toggle

**Expected Result:**
- All logs disappear
- Empty state message: "No logs yet..."
- Log count badge disappears

---

### 10. Keyboard Shortcuts ✓

**Delete Nodes:**
1. Click a node to select it (blue ring appears)
2. Press `Delete` or `Backspace`
3. Node and connected edges disappear

**Close Config Panel:**
1. Click a node to open config panel
2. Press `Escape`
3. Panel closes

---

### 11. Connection Validation ✓

**Test Type Compatibility:**
1. File Loader outputs type: `any`
2. Subfinder input requires type: `string`
3. These are compatible (any works with everything)

**Try to create duplicate connection:**
1. Connect File Loader → Subfinder
2. Try to connect File Loader → Subfinder again
3. Should show error: "Input already has a connection"

**Test cycle detection:**
1. Connect A → B → C
2. Try to connect C → A
3. Should show error: "Connection would create a cycle"

---

## 🎨 Visual Design Checks

### Node States
- **Idle:** White background, normal border
- **Running:** Amber border, amber background, spinning icon
- **Success:** Green border, green background, checkmark ✓
- **Error:** Red border, red background, X icon

### Colors by Type
- **Input nodes:** Blue border
- **Scan nodes:** Purple border
- **Process nodes:** Green border
- **Output nodes:** Orange border

### Component Badges
- **ShipSecAI:** Blue badge with checkmark
- **Latest:** Green badge with checkmark
- **Community:** Gray badge with users icon

---

## 🐛 Known Behaviors (Not Bugs!)

1. **Mock Execution:** Nodes execute sequentially with random 1-3s delays
2. **No Backend:** API calls are not actually made (service layer is ready though)
3. **No Persistence:** Workflows are not saved (need backend)
4. **90% Success Rate:** Mock execution randomly fails 10% of the time
5. **No Results Tab:** Only Logs tab is functional (Results/History coming later)

---

## 📱 Responsive Design

The app should work on large screens. Canvas uses React Flow which handles:
- Zoom in/out (mouse wheel)
- Pan (drag background)
- Minimap (bottom right)
- Controls (bottom left)

---

## 🔥 Advanced Testing

### Build a Real Workflow
1. Add File Loader
2. Connect to Subfinder
3. Add another Subfinder
4. Connect both to Merge
5. Configure parameters on each node
6. Run the workflow
7. Watch logs stream as it executes each node

### Test Parameter Persistence
1. Configure a node with custom parameters
2. Click away to close panel
3. Click node again
4. Parameters should be saved!

### Test Multiple Executions
1. Run workflow (wait for completion)
2. Run again (logs append to existing logs)
3. Click Clear to reset
4. Run again (fresh logs)

---

## ✅ Success Criteria

If all these work, the component system is **100% functional**:

- ✅ Components load from registry
- ✅ Nodes render with metadata
- ✅ Drag & drop works
- ✅ Connections validate types
- ✅ Config panel shows/edits parameters
- ✅ All 6 parameter types work
- ✅ Execution triggers and animates
- ✅ Logs stream in real-time
- ✅ Node states update during execution
- ✅ Stop button works
- ✅ Delete nodes works
- ✅ No console errors
- ✅ TypeScript happy
- ✅ Build succeeds

---

## 🎯 What You Should See

**When you first open http://localhost:5173/:**

1. **Left:** Sidebar with 3 components in sections
2. **Center:** Empty canvas with grid background
3. **Top:** "Untitled Workflow" with Save/Run buttons
4. **Bottom:** Collapsed panel with "Logs" tab
5. **No errors in browser console!**

**After dragging 3 nodes and connecting them:**

1. **Visual workflow** showing data flow
2. **Click a node** → Config panel slides in from right
3. **Click Run** → Bottom panel expands, nodes animate, logs stream
4. **After 10-15 seconds** → All nodes green with checkmarks

---

## 🚀 Next Steps

Once you've verified everything works:

1. **Backend Integration:** Implement endpoints from `API_CONTRACT.md`
2. **Add More Components:** Create more `.spec.json` files
3. **Save Workflows:** Implement actual save functionality
4. **Real Execution:** Replace mock execution with real API calls
5. **Add Features:** Templates, history, results display

---

## 💡 Pro Tips

- **Zoom:** Scroll wheel on canvas
- **Pan:** Drag canvas background
- **Select Multiple:** Shift + drag (React Flow feature)
- **Minimap:** Click to jump to area (bottom right)
- **Console:** Open browser DevTools to see logs and any errors

---

**Happy Testing! 🎉**

The Security Workflow Builder is fully operational!
