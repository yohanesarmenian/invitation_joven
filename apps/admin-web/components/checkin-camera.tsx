"use client";
import { useEffect, useRef, useState } from "react";
import { qrPattern } from "../src/checkin/contract";
import type { IScannerControls } from "@zxing/browser";

export function CheckinCamera({
  disabled,
  onDecode,
  onStart,
}: {
  disabled: boolean;
  onDecode: (payload: string) => void;
  onStart: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onDecode);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  useEffect(() => {
    callback.current = onDecode;
  }, [onDecode]);
  useEffect(() => {
    if (!active || disabled) return;
    let cancelled = false,
      delivered = false,
      stream: MediaStream | undefined,
      controls: IScannerControls | undefined;
    function stop() {
      cancelled = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (video.current) video.current.srcObject = null;
    }
    function end() {
      stop();
      setActive(false);
    }
    function hidden() {
      if (document.visibilityState === "hidden") end();
    }
    window.addEventListener("pagehide", end);
    window.addEventListener("admin:signout", end);
    document.addEventListener("visibilitychange", hidden);
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          setMessage(
            "Camera unavailable. Use HTTPS or localhost, or enter the QR code manually.",
          );
          setActive(false);
          return;
        }
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: device
            ? { deviceId: { exact: device } }
            : { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stop();
          return;
        }
        const inputs = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) {
          stop();
          return;
        }
        setDevices(inputs.filter((item) => item.kind === "videoinput"));
        if (!video.current) {
          end();
          return;
        }
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 250,
        });
        controls = await reader.decodeFromStream(
          stream,
          video.current,
          (result, _error, scanControls) => {
            if (!result || delivered || cancelled) return;
            const payload = result.getText();
            if (!qrPattern.test(payload)) {
              setMessage(
                "This is not an invitation pass. Point the camera at the guest's check-in QR.",
              );
              return;
            }
            delivered = true;
            scanControls.stop();
            end();
            callback.current(payload);
          },
        );
        if (cancelled) controls.stop();
      } catch (error) {
        const wasCancelled = cancelled;
        stop();
        if (wasCancelled) return;
        const name = error instanceof Error ? error.name : "";
        setMessage(
          name === "NotAllowedError"
            ? "Camera permission denied. Allow camera access or enter the QR manually."
            : "Camera unavailable or busy. Close other camera apps, choose another camera, or use manual entry.",
        );
        setActive(false);
      }
    })();
    return () => {
      stop();
      window.removeEventListener("pagehide", end);
      window.removeEventListener("admin:signout", end);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [active, disabled, device]);
  return (
    <div className="checkin-camera">
      {active && !disabled ? (
        <>
          <video
            ref={video}
            muted
            playsInline
            aria-label="Camera preview"
            style={{ width: "100%", maxHeight: 320, objectFit: "cover" }}
          />
          {devices.length > 1 && (
            <label>
              Camera
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="">Prefer rear camera</option>
                {devices.map((item, index) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" onClick={() => setActive(false)}>
            Stop camera
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setMessage("");
            onStart();
            setActive(true);
          }}
        >
          Start camera
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
