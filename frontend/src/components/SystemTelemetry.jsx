import { useEffect, useMemo, useState } from "react";

const KENOSHA_WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=42.5847&longitude=-87.8212&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph";

function weatherLabel(code) {
  if (code === 0) return "CLEAR";
  if (code <= 2) return "PARTLY CLOUDY";
  if (code === 3) return "OVERCAST";
  if (code <= 48) return "FOG";
  if (code <= 67) return "RAIN";
  if (code <= 77) return "SNOW";
  if (code <= 82) return "SHOWERS";
  return "STORMS";
}

function windDirection(degrees) {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(degrees / 45) % points.length];
}

export default function SystemTelemetry() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState({
    temperature: 72,
    apparentTemperature: 73,
    humidity: 62,
    weatherCode: 2,
    windSpeed: 8,
    windDirection: 45,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetch(KENOSHA_WEATHER_URL, { signal: controller.signal })
      .then((response) => response.json())
      .then(({ current }) => {
        if (!current) return;
        setWeather({
          temperature: Math.round(current.temperature_2m),
          apparentTemperature: Math.round(current.apparent_temperature),
          humidity: Math.round(current.relative_humidity_2m),
          weatherCode: current.weather_code,
          windSpeed: Math.round(current.wind_speed_10m),
          windDirection: current.wind_direction_10m,
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }).format(now),
    [now],
  );

  const date = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
        .format(now)
        .toUpperCase(),
    [now],
  );

  return (
    <div className="control-center-telemetry">
      <section className="telemetry-display telemetry-weather">
        <div className="telemetry-weather-primary">
          <svg
            className="telemetry-weather-icon"
            viewBox="0 0 52 42"
            aria-hidden="true"
          >
            <path d="M18 13a10 10 0 0 1 18-4" />
            <path d="M9 28a9 9 0 0 1 9-9 10 10 0 0 1 19 4h1a7 7 0 0 1 0 14H10a5 5 0 0 1-1-9Z" />
            <path d="M35 2v4M44 7l-3 3M48 17h-4" />
          </svg>
          <div>
            <strong>{weather.temperature}°F</strong>
            <span>{weatherLabel(weather.weatherCode)}</span>
          </div>
        </div>

        <div className="telemetry-weather-detail">
          <span>WIND</span>
          <strong>{weather.windSpeed} MPH</strong>
          <b>{windDirection(weather.windDirection)}</b>
        </div>

        <div className="telemetry-weather-detail">
          <span>FEELS LIKE</span>
          <strong>{weather.apparentTemperature}°</strong>
          <b>HUMIDITY&nbsp; {weather.humidity}%</b>
        </div>
      </section>

      <section className="telemetry-display telemetry-clock">
        <strong>{clock}</strong>
        <span>{date}</span>
      </section>
    </div>
  );
}
