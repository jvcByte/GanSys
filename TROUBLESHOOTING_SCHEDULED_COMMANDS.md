# Troubleshooting Scheduled Commands

## Current Status

✅ **Code Implementation**: Complete and committed (commit 247a096)
✅ **Git Repository**: Using only jvcByte/GanSys.git (maxwell remote removed)
✅ **Branch**: All changes on `dev` branch
❌ **Issue**: ESP32 not receiving `scheduledCommands` array from server

## The Problem

When you create a scheduled command from the dashboard and the ESP32 syncs, the server response shows:
```json
{
  "pendingCommands": [],
  "pestControlSchedule": null
  // ❌ Missing: "scheduledCommands": []
}
```

## Root Cause Analysis

The server code in `src/lib/services/device-sync.service.ts` **IS** correctly:
1. Querying scheduled commands: `db.select().from(scheduledCommands).where(...)`
2. Sending them in response: `scheduledCommands: pendingScheduledCommands.map(...)`

**Most Likely Cause**: Vercel hasn't deployed commit 247a096 yet.

## Verification Steps

### 1. Check Vercel Deployment Status

Go to your Vercel dashboard and verify:
- Is commit `247a096` deployed to production?
- Check deployment logs for any errors
- The deployment URL should be: `https://gansystems.vercel.app`

### 2. Verify Scheduled Command in Database

The scheduled command should exist with these properties:
- `controller_id` = the controller's database ID (NOT "ESP32-SOIL-IRRIGATION")
- `status` = "pending"
- `scheduled_for` = future timestamp

**Important**: The dashboard uses the controller's database ID (UUID), not the hardware ID.

### 3. Check Controller ID Mapping

Your ESP32 identifies as: `"ESP32-SOIL-IRRIGATION"` (hardwareId)
But the database uses a UUID like: `"ctrl_abc123xyz"` (id)

The scheduled command must be created for the correct controller UUID.

### 4. Manual Verification Query

If you have database access, run:
```sql
-- Find your controller
SELECT id, hardware_id, name FROM controllers WHERE hardware_id = 'ESP32-SOIL-IRRIGATION';

-- Check scheduled commands for that controller
SELECT * FROM scheduled_commands 
WHERE controller_id = '<controller_id_from_above>' 
AND status = 'pending';
```

## How to Fix

### Option 1: Wait for Vercel Deployment (Recommended)
1. Go to Vercel dashboard
2. Check if commit 247a096 is deployed
3. If not, manually trigger a deployment or wait for auto-deploy
4. Once deployed, test again

### Option 2: Force Vercel Redeploy
```bash
# In GanSys directory
git commit --allow-empty -m "Trigger Vercel redeploy"
git push origin dev
```

### Option 3: Verify Scheduled Command Creation
1. Go to dashboard: `https://gansystems.vercel.app/dashboard/controllers`
2. Click on your irrigation controller
3. Scroll to bottom "Automation" section
4. Create a new scheduled command for 2 minutes in the future
5. Watch ESP32 Serial Monitor for next sync (every 3 seconds)
6. Look for `scheduledCommands` array in the response

## Expected Behavior After Fix

When working correctly, the ESP32 Serial Monitor should show:
```
[SYNC] HTTP 200 {
  "serverTime": "2026-05-08T09:43:24.425Z",
  "controller": {...},
  "channelConfig": [...],
  "pendingCommands": [],
  "scheduledCommands": [
    {
      "commandId": "schcmd_abc123",
      "channelId": "ch_xyz789",
      "channelKey": "irrigation_valve_1",
      "commandType": "set_state",
      "desiredBooleanState": true,
      "scheduledFor": "2026-05-08T10:45:00.000Z",
      "note": "Test scheduled irrigation"
    }
  ],
  "pestControlSchedule": null
}
```

Then the ESP32 will:
1. Parse the `scheduledFor` timestamp
2. Store it in local memory
3. Check every second if current time >= scheduled time
4. Execute the command when time arrives
5. Send acknowledgement back to server

## Files Modified (Commit 247a096)

### Server-side:
- `src/lib/services/device-sync.service.ts` - Added scheduledCommands query and response

### ESP32-side:
- `c++/dual_soil_irrigation/dual_soil_irrigation.ino` - Added scheduled command storage and execution
- `c++/water_tank/water_tank.ino` - Added scheduled command storage with RTC

### Documentation:
- `ESP32_SCHEDULING_IMPLEMENTATION.md` - Complete implementation guide
- `c++/dual_soil_irrigation/SCHEDULING_ADDED.md` - Quick reference
- `c++/water_tank/SCHEDULING_QUICK_REFERENCE.md` - RTC-based scheduling guide

## Next Steps

1. **Check Vercel deployment status** - This is the most likely issue
2. If deployed, verify the scheduled command was created for the correct controller
3. Create a new test scheduled command 2 minutes in the future
4. Monitor ESP32 Serial Monitor for the `scheduledCommands` array
5. If still not working, check database directly to verify the scheduled command exists

## Contact Points

- Repository: https://github.com/jvcByte/GanSys.git
- Branch: `dev`
- Latest Commit: `247a096`
- ESP32 Device ID: `ESP32-SOIL-IRRIGATION`
- Server URL: `https://gansystems.vercel.app/api/device/sync`
