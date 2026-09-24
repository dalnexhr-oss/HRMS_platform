// Report command errors consistently without exposing configuration values.
export function runCommand(command) {
  command().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
