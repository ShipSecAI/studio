# 🗺️ Development Roadmap

## ✅ Phase 1-3: Component System - COMPLETED!

All foundational work is complete. The Security Workflow Builder frontend is fully functional with:
- Component registry and metadata system
- Visual workflow builder with React Flow
- Configuration panel with dynamic parameters
- Execution engine with mock simulation
- Logs display and real-time updates
- API service layer ready for backend

---

## 🎯 Next Steps (Priority Order)

### **Option A: Backend Integration (Recommended Next)**

Since the frontend is complete, the natural next step is to build or integrate with the backend.

#### 1. **Backend API Development** (High Priority)
**Goal:** Implement the endpoints defined in `API_CONTRACT.md`

**Tasks:**
- [ ] Set up backend server (Go/Python/Node.js based on project choice)
- [ ] Implement workflow storage (database)
- [ ] Implement component registry API
- [ ] Implement execution engine
- [ ] Implement real security tool integrations (Subfinder, Amass, etc.)

**Files to reference:**
- `API_CONTRACT.md` - Complete API specification
- `src/services/api.ts` - Frontend service expecting these endpoints

**Estimated Time:** 2-3 weeks

---

#### 2. **Replace Mock Execution with Real API** (After Backend Ready)
**Goal:** Connect frontend to real backend execution

**Tasks:**
- [ ] Update `executionStore.ts` to use `api.executions.start()`
- [ ] Remove `mockExecution` function
- [ ] Implement real polling with `api.executions.getStatus()`
- [ ] Test with real workflow execution

**Files to modify:**
- `src/store/executionStore.ts` (lines 47-69: replace TODO comments)
- `src/pages/WorkflowBuilder.tsx` (line 26: replace mockExecution call)

**Estimated Time:** 1-2 days

---

#### 3. **Workflow Persistence** (After Backend Ready)
**Goal:** Save and load workflows from backend

**Tasks:**
- [ ] Implement save workflow functionality
- [ ] Implement load workflow functionality
- [ ] Implement workflow list page
- [ ] Add auto-save feature

**Files to modify:**
- `src/pages/WorkflowBuilder.tsx` (handleSave function)
- `src/pages/WorkflowList.tsx` (populate with real data)
- Create `src/store/workflowStore.ts`

**Estimated Time:** 2-3 days

---

### **Option B: Add More Components (Can Do in Parallel)**

**Goal:** Expand the component library with more security tools

#### 4. **Add New Security Tool Components**
**Tasks:**
- [ ] Create Amass component spec
- [ ] Create Nmap component spec
- [ ] Create Nuclei component spec
- [ ] Create HTTPx component spec
- [ ] Create Naabu component spec

**How to add a component:**
1. Create `ComponentName.spec.json` in appropriate category folder
2. Define inputs, outputs, and parameters
3. Import in `src/components/workflow/nodes/registry.ts`
4. Component automatically appears in sidebar!

**Template:**
```json
{
  "id": "uuid",
  "name": "Tool Name",
  "slug": "tool-slug",
  "version": "1.0.0",
  "category": "security-tool",
  "type": "scan",
  "author": { "name": "ShipSector", "type": "shipsector" },
  "description": "Brief description",
  "icon": "LucideIconName",
  "isLatest": true,
  "deprecated": false,
  "inputs": [...],
  "outputs": [...],
  "parameters": [...]
}
```

**Estimated Time:** 1 hour per component (frontend only)

---

#### 5. **Add Building Block Components**
**Tasks:**
- [ ] Filter component (filter arrays by conditions)
- [ ] Transform component (modify data structure)
- [ ] Split component (split data into multiple outputs)
- [ ] Deduplicate component
- [ ] HTTP Request component
- [ ] Conditional component (if/else logic)

**Estimated Time:** 1 hour per component

---

#### 6. **Add Input/Output Components**
**Tasks:**
- [ ] Database Loader (PostgreSQL, MongoDB)
- [ ] API Loader (fetch from external API)
- [ ] CSV Exporter
- [ ] JSON Exporter
- [ ] Slack Notifier
- [ ] Email Notifier
- [ ] Webhook Output

**Estimated Time:** 1-2 hours per component

---

### **Option C: UI/UX Enhancements**

#### 7. **Improve User Experience**
**Tasks:**
- [ ] Add toast notifications (replace alerts)
- [ ] Add loading states
- [ ] Add error boundaries
- [ ] Add undo/redo functionality
- [ ] Add keyboard shortcuts documentation
- [ ] Add workflow validation before execution
- [ ] Add node search in sidebar

**Estimated Time:** 1 week

---

#### 8. **Results Display**
**Goal:** Show execution results in bottom panel

**Tasks:**
- [ ] Create Results tab component
- [ ] Display node outputs in table format
- [ ] Add export results functionality
- [ ] Add result visualization (charts, graphs)

**Files to modify:**
- `src/components/layout/BottomPanel.tsx`
- Create `src/components/workflow/ResultsPanel.tsx`

**Estimated Time:** 3-4 days

---

#### 9. **Execution History**
**Goal:** Show past workflow executions

**Tasks:**
- [ ] Create History tab component
- [ ] List past executions with status
- [ ] Allow viewing logs from past executions
- [ ] Add re-run capability

**Files to modify:**
- `src/components/layout/BottomPanel.tsx`
- Create `src/components/workflow/HistoryPanel.tsx`

**Estimated Time:** 2-3 days

---

### **Option D: Advanced Features**

#### 10. **Workflow Templates**
**Tasks:**
- [ ] Create template system
- [ ] Add predefined workflow templates
- [ ] Add "Start from template" functionality
- [ ] Add template marketplace

**Estimated Time:** 1 week

---

#### 11. **Scheduled Executions**
**Tasks:**
- [ ] Add scheduling UI
- [ ] Integrate with backend scheduler
- [ ] Add cron expression builder
- [ ] Show scheduled workflows

**Estimated Time:** 1 week

---

#### 12. **Real-time Updates (WebSocket)**
**Goal:** Replace polling with WebSocket for real-time execution updates

**Tasks:**
- [ ] Set up WebSocket connection
- [ ] Update execution store to use WebSocket
- [ ] Handle reconnection logic
- [ ] Update API contract

**Files to modify:**
- `src/store/executionStore.ts`
- `src/services/api.ts`

**Estimated Time:** 3-4 days

---

#### 13. **Workflow Versioning**
**Tasks:**
- [ ] Add version control for workflows
- [ ] Show workflow history
- [ ] Allow reverting to previous versions
- [ ] Add diff view

**Estimated Time:** 1 week

---

#### 14. **Collaborative Editing**
**Tasks:**
- [ ] Add multi-user support
- [ ] Show other users' cursors
- [ ] Real-time collaboration
- [ ] Conflict resolution

**Estimated Time:** 2-3 weeks

---

## 📋 Recommended Path Forward

### **Immediate Next Steps (This Week):**

1. **Test the Current Build** (1-2 hours)
   - Follow `TESTING_GUIDE.md`
   - Report any bugs or issues
   - Verify all features work

2. **Add 2-3 More Security Components** (3-4 hours)
   - Add Amass, Nmap, Nuclei spec files
   - Test in the UI

3. **Start Backend Planning** (1 day)
   - Choose backend technology (Go recommended for security tools)
   - Review `API_CONTRACT.md`
   - Set up project structure

### **Short Term (Next 2 Weeks):**

4. **Build Backend API** (2 weeks)
   - Implement core endpoints
   - Add workflow storage
   - Integrate 1-2 real security tools

5. **Connect Frontend to Backend** (2-3 days)
   - Replace mock execution
   - Test real workflow execution
   - Add error handling

### **Medium Term (Next Month):**

6. **Add More Components** (ongoing)
   - 10+ security tools
   - 5+ building blocks
   - 5+ I/O components

7. **Results & History** (1 week)
   - Complete bottom panel tabs
   - Add result visualization

8. **UX Improvements** (1 week)
   - Toast notifications
   - Better error handling
   - Workflow validation

### **Long Term (Next Quarter):**

9. **Advanced Features**
   - Scheduling
   - Templates
   - WebSocket updates
   - Versioning

10. **Production Deployment**
    - CI/CD pipeline
    - Docker containers
    - Monitoring & logging
    - Documentation

---

## 🎯 Quick Wins (Can Do Now!)

These are small improvements you can make immediately:

- [ ] Add more component spec files (1 hour each)
- [ ] Improve component descriptions
- [ ] Add more parameter validations
- [ ] Create workflow templates as JSON files
- [ ] Write user documentation
- [ ] Create demo video/screenshots
- [ ] Add unit tests for utilities

---

## 🐛 Known Issues to Address

Currently none! But as you test, track issues here:

- [ ] TBD based on testing

---

## 📊 Progress Tracking

**Frontend Completion:** 100% ✅
- Component System: 100%
- Visual Builder: 100%
- Configuration: 100%
- Execution: 100% (mock)
- API Layer: 100%

**Backend Completion:** 0% ⏳
- Next priority!

**Overall Project:** ~50% complete
- Frontend ready, backend needed

---

## 🤝 How to Prioritize

**If you're a frontend developer:**
→ Focus on Option C (UI/UX) and Option B (More Components)

**If you're a backend developer:**
→ Focus on Option A (Backend Integration)

**If you're a full-stack developer:**
→ Start with Option A (Backend), then Option B (Components)

**If you want quick wins:**
→ Add component specs (Option B, task 4-6)

---

## 📚 Resources

- **Design Document:** `updated_design_doc.md`
- **API Contract:** `API_CONTRACT.md`
- **Testing Guide:** `TESTING_GUIDE.md`
- **Component README:** `src/components/workflow/nodes/README.md`

---

**Current Status:** ✅ Frontend Complete, Ready for Backend!
