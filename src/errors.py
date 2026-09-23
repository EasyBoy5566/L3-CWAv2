"""Safe public errors; never include request URLs or credentials."""


class WeatherError(Exception):
    """Base class for errors that may be displayed in the dashboard."""


class ConfigurationError(WeatherError):
    pass


class APIRequestError(WeatherError):
    pass


class APIResponseError(WeatherError):
    pass


class WeatherParseError(WeatherError):
    pass


class DatabaseError(WeatherError):
    pass

