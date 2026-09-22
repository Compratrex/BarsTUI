export const profileName = 'Тестов Алексей Сергеевич';
export const profileHtml = `<form>
  <input name="__RequestVerificationToken" type="hidden" value="private-profile-csrf">
  <input id="Account" type="text" disabled value="public\\test-user">
  <input id="Account" type="hidden" value="public\\test-user">
  <div class="row mb-3"><label for="StudentAccounts">Роли</label><div>
    <span><a href="/bars_web/ST/Student/Main?studentID=old-student">Студент ${profileName} ТСТ-02-21 (ЛКС)</a></span><br>
    <span><a href="/bars_web/ST/Student/Main?studentID=fixture-student">Студент ${profileName} ТСТ-01м-25 (ЛКС)</a></span>
  </div></div>
  <input id="ExternalEmail" type="text" value="private-email@example.test">
  <input id="TotpSecretKey" type="text" value="private-totp-secret">
</form>`;
