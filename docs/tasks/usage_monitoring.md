# Usage Monitoring Feature Implementation Plan

This document outlines the plan for implementing the usage monitoring feature in the GenAIcode application. The feature will enhance the existing cost display and add new usage information metrics.

## 1. Updating Cost Display to Show Costs per AI Service

### Frontend Changes:

- Modify `CostDisplay` component in `cost-display.tsx`:
  - Implement a dropdown interface to show costs per AI service
  - Replace single total cost with a breakdown per AI service
- Update `AppLayout` component in `app-layout.tsx` to accommodate the new cost display

### Backend Changes:

- Enhance `cost-collector.ts`:
  - Modify `collectCost` function to include AI service type
  - Add a function to aggregate costs per AI service

## 2. Implementing Usage Information Display

### Frontend Changes:

- Create a new `UsageDisplay` component:
  - Display RPM, RPD, TPM, TPD, and IPM metrics
  - Utilize the current updating mechanism (similar to how costs are currently updated)
- Integrate `UsageDisplay` into `AppLayout`

### Backend Changes:

- Extend `cost-collector.ts`:
  - Add functions to track and calculate usage metrics
  - Implement mechanisms to calculate per-minute and per-day metrics
- Update `service.ts` to provide new usage data endpoints

## 3. Creating a Caching Mechanism for Cost and Token Usage Logs

### Backend Changes:

- Extend the existing `cache-file.ts`:
  - Implement functionality to handle cost and token usage data
  - Store cost and usage data with timestamps
  - Implement a cleanup mechanism to remove data older than 48 hours
  - Ensure thread-safe operations for data access and modification
- Add data persistence to maintain cache across application restarts

## 4. Necessary Changes in Frontend and Backend

### Frontend:

- New components: `UsageDisplay`
- Modified components: `CostDisplay`, `AppLayout`
- Implement new API calls to fetch usage data and detailed cost information

### Backend:

- Enhanced `cost-collector.ts` with new tracking and calculation functions
- New endpoints in `service.ts` to serve usage and detailed cost data
- Caching mechanism implementation using extended `cache-file.ts`

## 5. Integration and Testing

- Integrate all new components and functionalities
- Implement comprehensive testing for new features
- Ensure compatibility with existing codebase

## 6. Performance Considerations

- Monitor the impact of the new feature on application performance
- Optimize data structures for quick aggregation and retrieval of usage metrics
- Ensure efficient updates of the UI components displaying usage information

This implementation plan covers all aspects of the usage monitoring feature, including cost display updates, usage information display, caching mechanism, and necessary frontend and backend changes. The plan utilizes existing mechanisms where possible (such as the current cost updating system) and introduces new components and functionalities as needed to fulfill the requirements.
