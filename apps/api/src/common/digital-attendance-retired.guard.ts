import { GoneException, Injectable, type CanActivate } from "@nestjs/common";

@Injectable()
export class DigitalAttendanceRetiredGuard implements CanActivate {
  canActivate(): never {
    throw new GoneException({
      code: "DIGITAL_ATTENDANCE_RETIRED",
      message: "Digital attendance is no longer available.",
    });
  }
}
