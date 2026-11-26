import { useOutletContext } from "react-router-dom";

/** Trang con của khu ban tổ chức nhận organizerId qua Outlet context (đã có token tenant). */
export interface OrganizerContext {
  organizerId: string;
}

export function useOrganizer(): OrganizerContext {
  return useOutletContext<OrganizerContext>();
}
