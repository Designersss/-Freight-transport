export const locales = ["ru", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ru";

export function isLocale(value: string): value is Locale {
  return locales.some((locale) => locale === value);
}

const ru = {
  auth: {
    login: "Вход",
    loginTitle: "Войдите в MOVARO",
    loginDescription: "Введите данные вашего аккаунта.",
    signup: "Регистрация",
    signupTitle: "Создайте аккаунт",
    signupDescription: "Укажите имя, электронную почту и пароль.",
    name: "Имя",
    email: "Электронная почта",
    password: "Пароль",
    newPassword: "Новый пароль",
    passwordHint: "От 12 до 128 символов",
    loginAction: "Войти",
    signupAction: "Создать аккаунт",
    forgot: "Забыли пароль?",
    forgotTitle: "Восстановление пароля",
    forgotDescription: "Укажите почту, связанную с аккаунтом.",
    send: "Отправить ссылку",
    resetTitle: "Новый пароль",
    resetDescription: "Придумайте новый пароль для аккаунта.",
    resetAction: "Сохранить пароль",
    backLogin: "Вернуться ко входу",
    noAccount: "Нет аккаунта?",
    hasAccount: "Уже есть аккаунт?",
    verificationTitle: "Подтверждение почты",
    verificationDescription:
      "Проверьте почту. Для входа необходимо подтвердить адрес электронной почты.",
    resend: "Отправить письмо повторно",
    sent: "Если адрес подходит для этой операции, письмо будет отправлено. Проверьте входящие и спам.",
    resetSent:
      "Если аккаунт существует, вы получите письмо со ссылкой для восстановления.",
    resetDone: "Пароль изменён. Войдите с новым паролем.",
    invalidLink: "Ссылка недействительна или устарела. Запросите новую.",
    invalidEmail: "Введите корректный email.",
    invalidName: "Введите имя (до 200 символов).",
    invalidPassword: "Проверьте длину пароля.",
    error: "Не удалось выполнить запрос. Проверьте данные и повторите попытку.",
    limited: "Слишком много попыток. Попробуйте позже.",
    unavailable: "Сервис авторизации недоступен. Попробуйте позже.",
    submitting: "Выполняется…",
    accountTitle: "Ваш аккаунт",
    accountDescription:
      "Вы вошли в систему. Доступ к рабочим разделам будет предоставлен после завершения настройки профиля.",
    logout: "Выйти",
    verificationError: "Не удалось подтвердить почту. Запросите новое письмо.",
    verificationNext: "После подтверждения почты войдите в аккаунт.",
    returnHome: "На главную",
  },
  common: {
    theme: "Светлая тема",
    language: "Язык",
    navigation: "Основная навигация",
    skip: "Перейти к содержимому",
  },
  web: {
    title: "Управление арендой техники",
    description:
      "MOVARO — платформа для управления бизнесом по сдаче техники в аренду.",
  },
  admin: {
    title: "Администрирование",
    description:
      "Доступ к управлению платформой будет предоставляться только авторизованным администраторам.",
  },
};

const en: typeof ru = {
  auth: {
    login: "Sign in",
    loginTitle: "Sign in to MOVARO",
    loginDescription: "Enter your account credentials.",
    signup: "Sign up",
    signupTitle: "Create an account",
    signupDescription: "Enter your name, email and password.",
    name: "Name",
    email: "Email address",
    password: "Password",
    newPassword: "New password",
    passwordHint: "12–128 characters",
    loginAction: "Sign in",
    signupAction: "Create account",
    forgot: "Forgot password?",
    forgotTitle: "Reset your password",
    forgotDescription: "Enter the email associated with your account.",
    send: "Send link",
    resetTitle: "New password",
    resetDescription: "Choose a new password for your account.",
    resetAction: "Save password",
    backLogin: "Back to sign in",
    noAccount: "No account?",
    hasAccount: "Already have an account?",
    verificationTitle: "Confirm your email",
    verificationDescription:
      "Check your inbox. You must confirm your email before signing in.",
    resend: "Resend email",
    sent: "If the address is eligible, an email will be sent. Check your inbox and spam folder.",
    resetSent:
      "If the account exists, you will receive a password reset email.",
    resetDone: "Password changed. Sign in with your new password.",
    invalidLink: "The link is invalid or expired. Request a new one.",
    invalidEmail: "Enter a valid email address.",
    invalidName: "Enter a name (up to 200 characters).",
    invalidPassword: "Check your password length.",
    error: "Request failed. Check your details and try again.",
    limited: "Too many attempts. Try again later.",
    unavailable: "Authentication is unavailable. Try again later.",
    submitting: "Working…",
    accountTitle: "Your account",
    accountDescription:
      "You are signed in. Access to work areas requires completing your profile.",
    logout: "Sign out",
    verificationError: "Email confirmation failed. Request a new message.",
    verificationNext: "Sign in after confirming your email.",
    returnHome: "Home",
  },
  common: {
    theme: "Light theme",
    language: "Language",
    navigation: "Main navigation",
    skip: "Skip to content",
  },
  web: {
    title: "Equipment rental management",
    description:
      "MOVARO is a platform for managing an equipment rental business.",
  },
  admin: {
    title: "Administration",
    description:
      "Platform administration will be available only to authorized administrators.",
  },
};

export const messages = { ru, en } satisfies Record<Locale, typeof ru>;
