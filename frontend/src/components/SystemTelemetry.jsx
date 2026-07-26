import { useEffect, useMemo, useState } from "react";

const KENOSHA_WEATHER_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=42.5847&longitude=-87.8212&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";

const CURRENT_FIELDS =
  "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m";

function projectWeatherUrl(project) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${project.latitude}&longitude=${project.longitude}&current=${CURRENT_FIELDS}&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
}

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

function constructionImpact(weather) {
  if (
    weather.weatherCode >= 95 ||
    weather.windSpeed >= 30 ||
    weather.temperature <= 10
  ) {
    return { level: "HIGH", action: "STOP / PROTECT", tone: "danger" };
  }

  if (
    weather.weatherCode >= 51 ||
    weather.windSpeed >= 18 ||
    weather.temperature <= 25 ||
    weather.temperature >= 100
  ) {
    return { level: "MODERATE", action: "SCHEDULE RISK", tone: "warning" };
  }

  return { level: "LOW", action: "GOOD TO GO", tone: "safe" };
}

function normalizeWeather(current) {
  return {
    temperature: Math.round(current.temperature_2m),
    apparentTemperature: Math.round(current.apparent_temperature),
    humidity: Math.round(current.relative_humidity_2m),
    precipitation: Number(current.precipitation || 0).toFixed(2),
    weatherCode: current.weather_code,
    windSpeed: Math.round(current.wind_speed_10m),
    windDirection: current.wind_direction_10m,
  };
}

function projectLocationLabel(project) {
  const savedLocation =
    typeof project.location === "string" ? project.location.trim() : "";

  if (
    savedLocation &&
    !/national|multi[-\s]?site|remote|multiple/i.test(savedLocation)
  ) {
    return savedLocation;
  }

  return "";
}

export default function SystemTelemetry() {
  const [now, setNow] = useState(() => new Date());
  const [weatherCenterOpen, setWeatherCenterOpen] = useState(false);
  const [weatherProjects, setWeatherProjects] = useState([]);
  const [weatherCenterStatus, setWeatherCenterStatus] = useState("STANDBY");
  const [projectWeather, setProjectWeather] = useState({});
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
        setWeather(normalizeWeather(current));
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!weatherCenterOpen || weatherProjects.length) return;

    const controller = new AbortController();

    async function loadProjectWeather() {
      setWeatherCenterStatus("CONNECTING TO MASON FORGE");

      try {
        const bootstrapResponse = await fetch(
          "/api/mason?path=api/connector/bootstrap",
          {
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        );
        if (!bootstrapResponse.ok) {
          throw new Error(`Project feed returned ${bootstrapResponse.status}`);
        }

        const bootstrap = await bootstrapResponse.json();
        const internalProjects = Array.isArray(bootstrap.projects)
          ? bootstrap.projects
          : [];
        const jobSiteProjects = internalProjects
          .map((project) => ({
            ...project,
            locationLabel: projectLocationLabel(project),
          }))
          .filter((project) => project.locationLabel);

        setWeatherProjects(jobSiteProjects);
        setProjectWeather({});
        setWeatherCenterStatus("SECURE PROJECT WEATHER PREVIEW");
      } catch (error) {
        if (error.name !== "AbortError") {
          setWeatherCenterStatus("INTERNAL FEED UNAVAILABLE");
        }
      }
    }

    loadProjectWeather();

    return () => controller.abort();
  }, [weatherCenterOpen, weatherProjects.length]);

  useEffect(() => {
    if (!weatherCenterOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setWeatherCenterOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [weatherCenterOpen]);

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
    <>
      <div className="control-center-telemetry">
        <button
          className="telemetry-display telemetry-weather"
          type="button"
          onClick={() => setWeatherCenterOpen(true)}
          aria-label="Open project weather control center"
        >
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
        </button>

        <section className="telemetry-display telemetry-clock">
          <strong>{clock}</strong>
          <span>{date}</span>
        </section>
      </div>

      {weatherCenterOpen && (
        <div
          className="weather-control-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setWeatherCenterOpen(false);
            }
          }}
        >
          <section
            className="weather-control-center"
            role="dialog"
            aria-modal="true"
            aria-label="Project Weather Control Center"
          >
            <header className="weather-control-header">
              <div>
                <span>{weatherCenterStatus}</span>
                <h2>Weather Control Center</h2>
              </div>
              <div className="weather-control-header-status">
                <span>PROJECTS MONITORED</span>
                <strong>
                  {weatherProjects.length ? weatherProjects.length : "—"}
                </strong>
              </div>
              <button
                type="button"
                className="weather-control-close"
                onClick={() => setWeatherCenterOpen(false)}
                aria-label="Close weather control center"
              >
                ×
              </button>
            </header>

            <div className="weather-control-grid">
              {!weatherProjects.length && (
                <article className="weather-project-card weather-project-loading">
                  <div className="weather-project-loading-pulse" />
                  <span>SECURE INTERNAL PROJECT FEED</span>
                  <strong>{weatherCenterStatus}</strong>
                </article>
              )}

              {weatherProjects.map((project) => {
                const reading = projectWeather[String(project.id)];
                const impact = reading
                  ? constructionImpact(reading)
                  : {
                      level: "PENDING",
                      action: "WEATHER LINK",
                      tone: "pending",
                    };

                return (
                  <article
                    className={`weather-project-card weather-project-${impact.tone}`}
                    key={project.id}
                  >
                    <div className="weather-project-heading">
                      <div>
                        <span>{project.name}</span>
                        <strong>{project.locationLabel}</strong>
                      </div>
                      <i>
                        {reading ? "VERIFIED" : "INTERNAL"}
                      </i>
                    </div>

                    <div className="weather-project-current">
                      <strong>{reading ? `${reading.temperature}°` : "--°"}</strong>
                      <div>
                        <span>
                          {reading
                            ? weatherLabel(reading.weatherCode)
                            : "CONNECTION READY"}
                        </span>
                        <b>
                          FEELS LIKE {reading ? `${reading.apparentTemperature}°` : "--"}
                        </b>
                      </div>
                    </div>

                    <div className="weather-project-metrics">
                      <div>
                        <span>WIND</span>
                        <strong>
                          {reading ? `${reading.windSpeed} MPH` : "--"}
                        </strong>
                        <b>
                          {reading ? windDirection(reading.windDirection) : "--"}
                        </b>
                      </div>
                      <div>
                        <span>PRECIPITATION</span>
                        <strong>{reading ? `${reading.precipitation} IN` : "--"}</strong>
                        <b>LIVE</b>
                      </div>
                      <div>
                        <span>CONSTRUCTION IMPACT</span>
                        <strong>{impact.level}</strong>
                        <b>{impact.action}</b>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
