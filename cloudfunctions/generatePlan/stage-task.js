function mapStageActionToTaskFields(action, dayIndex, actionIndex) {
  return {
    title: action.title,
    description: action.description,
    actionType: action.actionType || "",
    completionCriteria: action.completionCriteria || "",
    requiredResources: Array.isArray(action.requiredResources)
      ? [...action.requiredResources]
      : [],
    safetyNotes: Array.isArray(action.safetyNotes) ? [...action.safetyNotes] : [],
    estimatedMinutes: action.estimatedMinutes,
    slotId: action.slotId || `slot_day_${dayIndex}_${actionIndex + 1}`,
    order: actionIndex + 1,
  };
}

module.exports = { mapStageActionToTaskFields };
