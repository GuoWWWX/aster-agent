import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Terminates only an application-owned process group/tree and waits for taskkill. */
export async function terminateProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
    const deadline = Date.now() + 5_000;
    for (;;) {
      try { process.kill(-pid, 0); } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
        throw error;
      }
      if (Date.now() >= deadline) throw new Error(`Owned process group ${pid} did not exit.`);
      await delay(25);
    }
  }
  await new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore", windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("close", (code) => {
      if (code === 0) { resolve(); return; }
      try {
        process.kill(pid, 0);
        reject(new Error(`Unable to stop owned process tree ${pid}.`));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") resolve();
        else reject(error instanceof Error ? error : new Error("Unable to stop owned process tree.", { cause: error }));
      }
    });
  });
}
