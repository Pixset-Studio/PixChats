# Русские шаблоны писем Supabase

Вставляются в Supabase Dashboard → Authentication → Email Templates.
Для каждого шаблона — своя вкладка (Confirm signup, Magic Link, и т.д.), поля Subject и Message.

## Confirm signup (подтверждение регистрации)

**Subject:**
```
Подтвердите регистрацию в PixChats
```

**Message body:**
```html
<h2>Добро пожаловать в PixChats!</h2>
<p>Чтобы завершить регистрацию, подтвердите свой email — просто перейдите по ссылке ниже:</p>
<p><a href="{{ .ConfirmationURL }}">Подтвердить email</a></p>
<p>Если вы не регистрировались в PixChats, просто проигнорируйте это письмо.</p>
<p>— Команда Pixset Studio</p>
```

## Magic Link / вход по коду (Email OTP)

Этот же шаблон используется для входа по коду, который мы подключаем ниже.

**Subject:**
```
Код для входа в PixChats
```

**Message body:**
```html
<h2>Ваш код для входа в PixChats</h2>
<p>Введите этот код в приложении, чтобы войти:</p>
<h1 style="letter-spacing: 4px;">{{ .Token }}</h1>
<p>Код действителен ограниченное время. Если вы не запрашивали вход — проигнорируйте письмо.</p>
<p>— Команда Pixset Studio</p>
```

## Reset Password (сброс пароля, на будущее)

**Subject:**
```
Восстановление пароля PixChats
```

**Message body:**
```html
<h2>Восстановление пароля</h2>
<p>Перейдите по ссылке, чтобы задать новый пароль:</p>
<p><a href="{{ .ConfirmationURL }}">Восстановить пароль</a></p>
<p>Если это были не вы — просто проигнорируйте письмо, пароль останется прежним.</p>
<p>— Команда Pixset Studio</p>
```
