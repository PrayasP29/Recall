// Fresh attempts use LeetCode's native reset control when the content adapter
// can identify exactly one enabled control with the reset label.
export const canSafelyResetEditor = 'native-control'

export function freshAttemptFallback() {
  return {
    status: 'requires-native-control',
    editorChanged: false,
    automaticSubmission: false,
    otherLanguageDraftsPreserved: true,
    acceptedSubmissionsPreserved: true,
  }
}
