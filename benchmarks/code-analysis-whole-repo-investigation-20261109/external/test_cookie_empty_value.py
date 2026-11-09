from requests.cookies import cookiejar_from_dict


def test_empty_string_cookie_value_is_found():
    jar = cookiejar_from_dict({"token": ""})
    assert jar.get("token") == ""
    assert "token" in jar
    assert jar["token"] == ""
    assert dict(jar) == {"token": ""}
