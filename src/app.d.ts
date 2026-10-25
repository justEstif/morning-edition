// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface PageProps {}
    /** Set by the session gate in hooks.server.ts: the authenticated
     *  admin username, or null when the request is anonymous. */
    interface Locals {
      user: string | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
