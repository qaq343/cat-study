!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\小猫学习进度.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\${MAINBINARYNAME}.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\小猫学习进度.lnk"
!macroend
