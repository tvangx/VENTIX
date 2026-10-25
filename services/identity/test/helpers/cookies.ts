import type { Response } from "supertest";

export const responseCookie = (response: Response, name = "ventix_refresh"): string => {
  const header = response.headers["set-cookie"] as unknown as string[];
  return header.find((value) => value.startsWith(`${name}=`))!.split(";")[0];
};
