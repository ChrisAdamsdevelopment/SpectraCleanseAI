function buildForgotPasswordGenericResponse(emailDeliveryConfigured) {
  return {
    status: 200,
    body: {
      message: 'If an account exists, a reset link was sent.',
      emailDeliveryConfigured: Boolean(emailDeliveryConfigured),
    },
  };
}

function buildUnauthResendVerificationGenericResponse(emailDeliveryConfigured) {
  return {
    status: 200,
    body: {
      message: 'If eligible, a verification email has been sent.',
      emailDeliveryConfigured: Boolean(emailDeliveryConfigured),
    },
  };
}

module.exports = {
  buildForgotPasswordGenericResponse,
  buildUnauthResendVerificationGenericResponse,
};
