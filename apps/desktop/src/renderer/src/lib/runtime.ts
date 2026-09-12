export const getRuntimeConfig = (() => {
  let config: ReturnType<Window["space"]["getRuntimeConfig"]> | undefined;
  return () => (config ??= window.space.getRuntimeConfig());
})();
